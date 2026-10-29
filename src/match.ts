// Local match and ATS scoring: no AI, no network, so it is free and runs on every result.

// Skills commonly requested in tech/office job posts. Profile skills are added on top,
// so this only needs the terms a user might be *missing*.
const KNOWN_SKILLS = [
  "python", "java", "javascript", "typescript", "react", "angular", "vue", "node.js", "node", "php", "laravel",
  "django", "flask", "fastapi", "spring", "c#", ".net", "go", "golang", "rust", "kotlin", "swift", "ruby", "rails",
  "sql", "postgresql", "postgres", "mysql", "sql server", "oracle", "mongodb", "redis", "elasticsearch",
  "docker", "kubernetes", "aws", "azure", "gcp", "terraform", "linux", "git", "ci/cd", "jenkins", "github actions",
  "html", "css", "sass", "tailwind", "graphql", "rest", "api", "microservices", "odoo", "sap", "erp", "crm",
  "power bi", "excel", "tableau", "etl", "spark", "airflow", "pandas", "machine learning", "data science",
  "scrum", "agile", "jira", "kanban", "testing", "qa", "selenium", "cypress", "devops", "seo", "figma",
  "inglés", "english", "liderazgo", "leadership", "facturación electrónica", "sri", "contabilidad", "accounting",
  "ventas", "sales", "atención al cliente", "customer service", "logística", "logistics", "inventario", "inventory",
];

const STOPWORDS = new Set(
  ("a al algo ante antes como con contra cual cuando de del desde donde durante el ella ellos en entre era es esa ese esta este " +
    "esto estos fue ha hay la las le les lo los mas más me mi muy no nos o otra otro para pero por porque que qué se sea ser si sí " +
    "sin sobre su sus también te tiene tu un una uno unos y ya usted ustedes nuestro nuestra nuestros equipo empresa trabajo " +
    "the and for with you your our are will have this that from not but all can job work team role who what when where which " +
    "about into more than their they them was were been being has had its it's also experience años year years plus")
    .split(" "),
);

export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function containsTerm(haystack: string, term: string): boolean {
  const t = normalize(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${t}($|[^\\p{L}\\p{N}])`, "u").test(haystack);
}

export interface MatchResult {
  /** 0–100, or null when the offer mentions no recognizable skill. */
  score: number | null;
  matched: string[];
  missing: string[];
}

/** Skills the offer asks for, split into the ones the profile/CV shows and the ones it doesn't. */
export function matchJob(jobText: string, profileSkills: string[], cvText: string): MatchResult {
  const job = normalize(jobText);
  const cv = normalize(cvText);
  const seen = new Set<string>();
  const requested = [...profileSkills, ...KNOWN_SKILLS].filter((s) => {
    const key = normalize(s.trim());
    if (!key || seen.has(key) || !containsTerm(job, key)) return false;
    seen.add(key);
    return true;
  });
  const has = (s: string) => profileSkills.some((p) => normalize(p) === normalize(s)) || containsTerm(cv, s);
  const matched = requested.filter(has);
  const missing = requested.filter((s) => !has(s));
  return {
    score: requested.length ? Math.round((matched.length / requested.length) * 100) : null,
    matched,
    missing,
  };
}

/** The offer's most frequent meaningful words: what an ATS keyword filter looks for. */
export function topKeywords(jobText: string, limit = 20): string[] {
  const counts = new Map<string, number>();
  for (const word of normalize(jobText).match(/[\p{L}][\p{L}\p{N}+#.]{2,}/gu) ?? []) {
    const w = word.replace(/\.$/, "");
    if (w.length < 4 || STOPWORDS.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

/** Share (0–100) of the offer's top keywords that appear in the CV text. */
export function atsScore(jobText: string, cvText: string): number {
  const keywords = topKeywords(jobText);
  if (!keywords.length) return 0;
  const cv = normalize(cvText);
  return Math.round((keywords.filter((k) => containsTerm(cv, k)).length / keywords.length) * 100);
}

// Self-check of the scoring rules; runs once at module load in dev builds only.
if (import.meta.env.DEV) {
  const m = matchJob("Buscamos dev Python con Docker y Kubernetes", ["Python"], "Experiencia en Docker");
  console.assert(m.score === 67 && m.missing.join() === "kubernetes", "matchJob self-check failed", m);
  console.assert(atsScore("docker docker kubernetes", "docker") === 50, "atsScore self-check failed");
}
