import { fetch } from "@tauri-apps/plugin-http";
import { getSecret, type AppSettings } from "../settings";

/** A job offer normalized from any portal; maps 1:1 onto the jobs table. */
export interface JobInput {
  source: string;
  external_id: string;
  url: string | null;
  title: string;
  company: string | null;
  location: string | null;
  remote: boolean;
  salary_text: string | null;
  description: string;
  posted_at: string | null;
}

export interface SearchQuery {
  keywords: string;
  location: string;
  remoteOnly: boolean;
}

export interface SourceInfo {
  id: string;
  label: string;
  needsKey: boolean;
}

export const SOURCES: SourceInfo[] = [
  { id: "remotive", label: "Remotive (remoto)", needsKey: false },
  { id: "adzuna", label: "Adzuna", needsKey: true },
  { id: "linkedin", label: "LinkedIn (búsqueda pública)", needsKey: false },
];

// Adzuna has no Ecuador index; these are the countries it covers that matter most here.
export const ADZUNA_COUNTRIES: { code: string; label: string }[] = [
  { code: "us", label: "Estados Unidos" }, { code: "es", label: "España" }, { code: "mx", label: "México" },
  { code: "br", label: "Brasil" }, { code: "ca", label: "Canadá" }, { code: "gb", label: "Reino Unido" },
];

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html.replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, "\n$&"), "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

interface RemotiveResponse {
  jobs: {
    id: number; url: string; title: string; company_name: string; candidate_required_location: string;
    salary: string; description: string; publication_date: string;
  }[];
}

async function searchRemotive(q: SearchQuery): Promise<JobInput[]> {
  const url = `https://remotive.com/api/remote-jobs?limit=50&search=${encodeURIComponent(q.keywords)}`;
  const data = await getJson<RemotiveResponse>(url);
  return data.jobs.map((j) => ({
    source: "remotive",
    external_id: String(j.id),
    url: j.url,
    title: j.title,
    company: j.company_name || null,
    location: j.candidate_required_location || "Remoto",
    remote: true,
    salary_text: j.salary || null,
    description: htmlToText(j.description),
    posted_at: j.publication_date || null,
  }));
}

interface AdzunaResponse {
  results: {
    id: string; redirect_url: string; title: string; description: string; created: string;
    company?: { display_name?: string }; location?: { display_name?: string };
    salary_min?: number; salary_max?: number;
  }[];
}

async function searchAdzuna(q: SearchQuery, settings: AppSettings): Promise<JobInput[]> {
  const secret = await getSecret("adzuna");
  if (!secret) throw new Error("falta la clave de Adzuna en Ajustes");
  const [appId, appKey] = secret.split(":");
  const params = new URLSearchParams({
    app_id: appId, app_key: appKey, results_per_page: "50", what: q.keywords, "content-type": "application/json",
  });
  if (q.location && !q.remoteOnly) params.set("where", q.location);
  if (q.remoteOnly) params.set("what_or", "remote remoto");
  const url = `https://api.adzuna.com/v1/api/jobs/${settings.adzuna_country}/search/1?${params}`;
  const data = await getJson<AdzunaResponse>(url);
  return data.results.map((j) => {
    const salary = j.salary_min && j.salary_max ? `${Math.round(j.salary_min)}–${Math.round(j.salary_max)}` : null;
    return {
      source: "adzuna",
      external_id: j.id,
      url: j.redirect_url,
      title: htmlToText(j.title),
      company: j.company?.display_name ?? null,
      location: j.location?.display_name ?? null,
      remote: /remot/i.test(j.title + " " + j.description),
      salary_text: salary,
      description: htmlToText(j.description),
      posted_at: j.created ?? null,
    };
  });
}

// LinkedIn: the public, logged-out job search endpoint its own jobs page uses. One request per
// search and one per opened offer, always user-initiated; no account, no headless browser.
// shortcut: depends on LinkedIn's guest HTML (class names); if they change it, update these selectors.
const LINKEDIN_GUEST = "https://www.linkedin.com/jobs-guest/jobs/api";

async function getHtml(url: string): Promise<Document> {
  const res = await fetch(url, { method: "GET", headers: { Accept: "text/html", "Accept-Language": "es-EC,es;q=0.9,en;q=0.8" } });
  if (res.status === 429) throw new Error("LinkedIn limitó las consultas; espere unos minutos");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new DOMParser().parseFromString(await res.text(), "text/html");
}

const text = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() || null;

async function searchLinkedIn(q: SearchQuery): Promise<JobInput[]> {
  const params = new URLSearchParams({ keywords: q.keywords, start: "0" });
  if (q.location && !q.remoteOnly) params.set("location", q.location);
  if (q.remoteOnly) params.set("f_WT", "2"); // LinkedIn's "remote" workplace filter
  const doc = await getHtml(`${LINKEDIN_GUEST}/seeMoreJobPostings/search?${params}`);
  return [...doc.querySelectorAll<HTMLElement>("div.base-search-card[data-entity-urn]")].flatMap((card) => {
    const id = card.dataset.entityUrn?.split(":").pop();
    const title = text(card, ".base-search-card__title");
    if (!id || !title) return [];
    const location = text(card, ".job-search-card__location");
    return [{
      source: "linkedin",
      external_id: id,
      url: `https://www.linkedin.com/jobs/view/${id}`,
      title,
      company: text(card, ".base-search-card__subtitle"),
      location,
      remote: q.remoteOnly || /remot/i.test(`${title} ${location ?? ""}`),
      salary_text: text(card, ".job-search-card__salary-info"),
      description: "", // fetched when the user opens the offer (fetchLinkedInDescription)
      posted_at: card.querySelector("time")?.getAttribute("datetime") ?? null,
    }];
  });
}

/** Full description of one LinkedIn offer, read from its public posting page. */
export async function fetchLinkedInDescription(externalId: string): Promise<string> {
  const doc = await getHtml(`${LINKEDIN_GUEST}/jobPosting/${encodeURIComponent(externalId)}`);
  const markup = doc.querySelector(".show-more-less-html__markup");
  if (!markup) throw new Error("LinkedIn no mostró la descripción de esta oferta");
  return htmlToText(markup.innerHTML);
}

export interface SearchResult {
  jobs: JobInput[];
  errors: { source: string; message: string }[];
}

/** Queries every enabled source in parallel; one failing source does not hide the others. */
export async function searchSources(q: SearchQuery, enabled: string[], settings: AppSettings): Promise<SearchResult> {
  const runners: Record<string, () => Promise<JobInput[]>> = {
    remotive: () => searchRemotive(q),
    adzuna: () => searchAdzuna(q, settings),
    linkedin: () => searchLinkedIn(q),
  };
  const ids = enabled.filter((id) => id in runners);
  const settled = await Promise.allSettled(ids.map((id) => runners[id]()));
  const result: SearchResult = { jobs: [], errors: [] };
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") result.jobs.push(...s.value);
    else result.errors.push({ source: ids[i], message: s.reason instanceof Error ? s.reason.message : String(s.reason) });
  });
  if (q.location && !q.remoteOnly) {
    // Remotive has no location filter; keep its offers only when they are open worldwide or match.
    const loc = q.location.toLowerCase();
    result.jobs = result.jobs.filter(
      (j) => j.source !== "remotive" || /worldwide|anywhere|latam|americas/i.test(j.location ?? "") || (j.location ?? "").toLowerCase().includes(loc),
    );
  }
  return result;
}
