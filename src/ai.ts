import Anthropic from "@anthropic-ai/sdk";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getDb, type Job } from "./db";
import type { Profile } from "./profile";
import { getSecret, loadSettings, type AiProvider, type AppSettings } from "./settings";

// Task names are logged in ai_usage; v2 adds "answer_question" here without touching the rest.
export type AiTask = "parse_cv" | "adapt_cv" | "cover_letter";

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  claude: "claude-opus-5-5",
  deepseek: "deepseek-chat",
  gemini: "gemini-2.5-flash",
  ollama: "llama3.1",
};

export const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5 — mejor calidad" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5 — equilibrio" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5 — más barato" },
];

// USD per million tokens (input, output). Other providers are logged with cost 0.
const CLAUDE_PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  // Models the server-side fallback may answer with.
  "claude-opus-5": [5, 25],
  "claude-sonnet-5": [2, 10],
  "claude-opus-4-8": [5, 25],
};

/** Claude price for the model that answered; an unknown ID is billed at the configured model's price, never 0. */
function claudePrice(answered: string, configured: string): [number, number] {
  return CLAUDE_PRICES[answered] ?? CLAUDE_PRICES[answered.replace(/-\d{8}$/, "")] ?? CLAUDE_PRICES[configured] ?? CLAUDE_PRICES["claude-opus-5-5"];
}

/** Only Claude usage has a known price, so the monthly limit can only count Claude. */
export const SPEND_LIMIT_PROVIDERS: AiProvider[] = ["claude"];
// Models that accept the server-side refusal fallback.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

interface Completion {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

type JsonSchema = Record<string, unknown>;

export async function monthSpendUsd(): Promise<number> {
  const [row] = await (await getDb()).select<{ total: number | null }[]>(
    "SELECT SUM(cost_usd) AS total FROM ai_usage WHERE created_at >= date('now', 'start of month')",
  );
  return row?.total ?? 0;
}

async function callClaude(s: AppSettings, system: string, user: string, schema: JsonSchema): Promise<Completion> {
  const apiKey = await getSecret("anthropic");
  if (!apiKey) throw new Error("Falta la clave de Claude. Cárguela en Ajustes.");
  // Local desktop app: the key belongs to the user and never leaves this machine except to Anthropic.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const response = await client.beta.messages.create({
    model: s.ai_model,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema } },
    ...(FALLBACK_MODELS.has(s.ai_model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });
  if (response.stop_reason === "refusal") throw new Error("La IA no quiso procesar esta solicitud. Revise el contenido e intente de nuevo.");
  if (response.stop_reason === "max_tokens") throw new Error("La respuesta de la IA quedó incompleta. Intente de nuevo.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return { text, model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
}

async function callDeepSeek(s: AppSettings, system: string, user: string): Promise<Completion> {
  const apiKey = await getSecret("deepseek");
  if (!apiKey) throw new Error("Falta la clave de DeepSeek. Cárguela en Ajustes.");
  // OpenAI-compatible API; goes through the Rust HTTP client (scoped in capabilities) to avoid CORS.
  const res = await tauriFetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: s.ai_model,
      stream: false,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("DeepSeek no devolvió contenido.");
  return {
    text,
    model: data.model ?? s.ai_model,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

async function callGemini(s: AppSettings, system: string, user: string): Promise<Completion> {
  const apiKey = await getSecret("gemini");
  if (!apiKey) throw new Error("Falta la clave de Gemini. Cárguela en Ajustes.");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.ai_model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini no devolvió contenido.");
  return {
    text,
    model: s.ai_model,
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

async function callOllama(s: AppSettings, system: string, user: string, schema: JsonSchema): Promise<Completion> {
  const res = await fetch(`${s.ollama_url.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: s.ai_model,
      stream: false,
      format: schema,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  }).catch(() => {
    throw new Error(`No se pudo conectar con Ollama en ${s.ollama_url}. ¿Está abierto?`);
  });
  if (!res.ok) throw new Error(`Ollama respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return { text: data.message?.content ?? "", model: s.ai_model, inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 };
}

/** Runs one AI task with the configured provider, enforces the monthly limit and logs the usage. */
async function runJson<T>(task: AiTask, system: string, user: string, schema: JsonSchema): Promise<T> {
  const s = await loadSettings();
  const limit = Number(s.ai_monthly_limit_usd);
  if (limit > 0 && (await monthSpendUsd()) >= limit) {
    throw new Error(`Llegó a su límite de gasto mensual en IA ($${limit}). Puede subirlo en Ajustes.`);
  }
  // Claude enforces the schema server-side; the others get it in the prompt as well.
  const withSchema = `${user}\n\nResponda SOLO con JSON que cumpla este esquema:\n${JSON.stringify(schema)}`;
  const c =
    s.ai_provider === "claude" ? await callClaude(s, system, user, schema)
    : s.ai_provider === "deepseek" ? await callDeepSeek(s, system, withSchema)
    : s.ai_provider === "gemini" ? await callGemini(s, system, withSchema)
    : await callOllama(s, system, withSchema, schema);

  // shortcut: DeepSeek/Gemini/Ollama are logged with tokens but cost 0 (no price table); Settings says the limit only counts Claude.
  const [inPrice, outPrice] = s.ai_provider === "claude" ? claudePrice(c.model, s.ai_model) : [0, 0];
  const cost = (c.inputTokens * inPrice + c.outputTokens * outPrice) / 1_000_000;
  await (await getDb()).execute(
    "INSERT INTO ai_usage (provider, model, task, input_tokens, output_tokens, cost_usd) VALUES ($1, $2, $3, $4, $5, $6)",
    [s.ai_provider, c.model, task, c.inputTokens, c.outputTokens, cost],
  );
  try {
    return JSON.parse(c.text) as T;
  } catch {
    // Non-Claude providers sometimes wrap the JSON in prose or code fences.
    const match = c.text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("La IA no devolvió un resultado válido. Intente de nuevo.");
    return JSON.parse(match[0]) as T;
  }
}

// ---- Schemas (structured outputs require every property listed in `required`) ----

const str = { type: "string" };
const strArray = { type: "array", items: str };
const obj = (properties: Record<string, unknown>) => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});

const EXPERIENCE = obj({ company: str, role: str, start_date: str, end_date: str, description: str });
const EDUCATION = obj({ institution: str, degree: str, start_date: str, end_date: str });
const LANGUAGE = obj({ language: str, level: str });

const PROFILE_SCHEMA = obj({
  personal: obj({
    full_name: str, email: str, phone: str, city: str, country: str, headline: str, summary: str,
    target_role: str, salary_expectation: str, availability: str, linkedin_url: str, portfolio_url: str,
  }),
  experience: { type: "array", items: EXPERIENCE },
  education: { type: "array", items: EDUCATION },
  skills: strArray,
  languages: { type: "array", items: LANGUAGE },
});

export interface TailoredCv {
  headline: string;
  summary: string;
  experience: { role: string; company: string; start_date: string; end_date: string; bullets: string[] }[];
  education: { degree: string; institution: string; start_date: string; end_date: string }[];
  skills: string[];
  languages: { language: string; level: string }[];
  keywords_added: string[];
  suggestions: string[];
}

const TAILORED_CV_SCHEMA = obj({
  headline: str,
  summary: str,
  experience: { type: "array", items: obj({ role: str, company: str, start_date: str, end_date: str, bullets: strArray }) },
  education: { type: "array", items: EDUCATION },
  skills: strArray,
  languages: { type: "array", items: LANGUAGE },
  keywords_added: strArray,
  suggestions: strArray,
});

const NO_INVENTION =
  "Never invent experience, employers, dates, degrees, certifications or skills. " +
  "Only reorder, rephrase and emphasise what the candidate's data already shows. " +
  "If the job asks for something the candidate does not show, mention it in `suggestions` instead of adding it.";

function jobBlock(job: Job): string {
  return [
    `Title: ${job.title}`,
    `Company: ${job.company ?? "-"}`,
    `Location: ${job.location ?? "-"}`,
    `Description:\n${job.description ?? ""}`,
  ].join("\n");
}

// ---- Shape guards: providers without server-side schemas can omit keys ----

const asStr = (v: unknown) => (typeof v === "string" ? v : "");
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asRec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const strs = (v: unknown) => asArr(v).map(asStr).filter(Boolean);
const pick = <K extends string>(v: unknown, keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, asStr(asRec(v)[k])])) as Record<K, string>;

const PERSONAL_KEYS = [
  "full_name", "email", "phone", "city", "country", "headline", "summary",
  "target_role", "salary_expectation", "availability", "linkedin_url", "portfolio_url",
] as const;

function toProfile(raw: unknown): Profile {
  const r = asRec(raw);
  return {
    personal: pick(r.personal, PERSONAL_KEYS),
    experience: asArr(r.experience).map((e) => pick(e, ["company", "role", "start_date", "end_date", "description"] as const)),
    education: asArr(r.education).map((e) => pick(e, ["institution", "degree", "start_date", "end_date"] as const)),
    skills: strs(r.skills),
    languages: asArr(r.languages).map((l) => pick(l, ["language", "level"] as const)),
  };
}

/** Also used when reading a stored cv_json, so an old malformed result cannot crash the screen. */
export function toTailoredCv(raw: unknown): TailoredCv {
  const r = asRec(raw);
  return {
    headline: asStr(r.headline),
    summary: asStr(r.summary),
    experience: asArr(r.experience).map((e) => ({
      ...pick(e, ["role", "company", "start_date", "end_date"] as const),
      bullets: strs(asRec(e).bullets),
    })),
    education: asArr(r.education).map((e) => pick(e, ["degree", "institution", "start_date", "end_date"] as const)),
    skills: strs(r.skills),
    languages: asArr(r.languages).map((l) => pick(l, ["language", "level"] as const)),
    keywords_added: strs(r.keywords_added),
    suggestions: strs(r.suggestions),
  };
}

// ---- Tasks ----

/** Turns the raw text of an imported CV into the structured profile. Empty string for anything not in the CV. */
export async function parseCvToProfile(cvText: string): Promise<Profile> {
  return toProfile(await runJson<unknown>(
    "parse_cv",
    "You extract structured data from a CV. Copy facts exactly as written; use an empty string for any field " +
      "the CV does not contain. Do not guess salary or availability. Keep the CV's original language.",
    `<cv>\n${cvText}\n</cv>`,
    PROFILE_SCHEMA,
  ));
}

export async function adaptCv(profile: Profile, cvText: string, job: Job): Promise<TailoredCv> {
  return toTailoredCv(await runJson<unknown>(
    "adapt_cv",
    "You are an expert recruiter who tailors CVs so they pass ATS keyword filters and read well to a human. " +
      NO_INVENTION +
      " Write the CV in the language of the job posting. Bullets: start with a verb, include concrete results when the " +
      "candidate's data has them, at most 5 per role. `keywords_added` lists job keywords the tailored CV now states " +
      "explicitly (only ones backed by the candidate's data). `suggestions` are short tips addressed to the candidate " +
      "using 'usted' when writing in Spanish.",
    `<candidate_profile>\n${JSON.stringify(profile)}\n</candidate_profile>\n<base_cv>\n${cvText}\n</base_cv>\n<job>\n${jobBlock(job)}\n</job>`,
    TAILORED_CV_SCHEMA,
  ));
}

export async function coverLetter(profile: Profile, cv: TailoredCv, job: Job): Promise<string> {
  const result = await runJson<{ letter: string }>(
    "cover_letter",
    "You write short, specific cover letters (180–250 words) in the language of the job posting, formal register " +
      "('usted' in Spanish). " + NO_INVENTION + " No placeholders: if a detail is unknown, leave it out.",
    `<candidate_profile>\n${JSON.stringify(profile.personal)}\n</candidate_profile>\n<tailored_cv>\n${JSON.stringify(cv)}\n</tailored_cv>\n<job>\n${jobBlock(job)}\n</job>`,
    obj({ letter: str }),
  );
  if (typeof result?.letter !== "string" || !result.letter.trim()) throw new Error("La IA no devolvió la carta. Intente de nuevo.");
  return result.letter;
}

/** The tailored CV as plain text, for ATS scoring and copy/paste. */
export function tailoredCvText(cv: TailoredCv): string {
  return [
    cv.headline,
    cv.summary,
    ...cv.experience.flatMap((e) => [`${e.role} — ${e.company} (${e.start_date} – ${e.end_date})`, ...e.bullets]),
    ...cv.education.map((e) => `${e.degree} — ${e.institution}`),
    cv.skills.join(", "),
    cv.languages.map((l) => `${l.language} (${l.level})`).join(", "),
  ].join("\n");
}
