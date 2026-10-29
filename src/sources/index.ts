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
  /** Only offers published in the last N days; null = any date. */
  maxDays: number | null;
}

export const DATE_FILTERS: { days: number | null; label: string }[] = [
  { days: null, label: "Cualquier fecha" },
  { days: 1, label: "Últimas 24 horas" },
  { days: 2, label: "Últimos 2 días" },
  { days: 7, label: "Última semana" },
  { days: 30, label: "Último mes" },
];

/** A page of one source; hasMore says whether asking for the next page can return more. */
export interface SourcePage {
  jobs: JobInput[];
  hasMore: boolean;
}

function withinDays(postedAt: string | null, maxDays: number | null): boolean {
  if (maxDays == null) return true;
  if (!postedAt) return false;
  return Date.now() - new Date(postedAt).getTime() <= maxDays * 86_400_000;
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

async function searchRemotive(q: SearchQuery, page: number): Promise<SourcePage> {
  // Remotive has no paging or date parameters: one page of up to 100, filtered here.
  if (page > 0) return { jobs: [], hasMore: false };
  const url = `https://remotive.com/api/remote-jobs?limit=100&search=${encodeURIComponent(q.keywords)}`;
  const data = await getJson<RemotiveResponse>(url);
  const loc = q.location.trim().toLowerCase();
  const jobs = data.jobs.map((j) => ({
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
  return {
    hasMore: false,
    jobs: jobs.filter(
      (j) =>
        withinDays(j.posted_at, q.maxDays) &&
        // No location filter on Remotive: keep offers open worldwide/LATAM or matching the city.
        (q.remoteOnly || !loc || /worldwide|anywhere|latam|americas/i.test(j.location) || j.location.toLowerCase().includes(loc)),
    ),
  };
}

interface AdzunaResponse {
  results: {
    id: string; redirect_url: string; title: string; description: string; created: string;
    company?: { display_name?: string }; location?: { display_name?: string };
    salary_min?: number; salary_max?: number;
  }[];
}

const ADZUNA_PAGE_SIZE = 20;

async function searchAdzuna(q: SearchQuery, settings: AppSettings, page: number): Promise<SourcePage> {
  const secret = await getSecret("adzuna");
  if (!secret) throw new Error("falta la clave de Adzuna en Ajustes");
  const [appId, appKey] = secret.split(":");
  const params = new URLSearchParams({
    app_id: appId, app_key: appKey, results_per_page: String(ADZUNA_PAGE_SIZE), what: q.keywords, "content-type": "application/json",
  });
  if (q.maxDays != null) params.set("max_days_old", String(q.maxDays));
  if (q.location && !q.remoteOnly) params.set("where", q.location);
  if (q.remoteOnly) params.set("what_or", "remote remoto");
  const url = `https://api.adzuna.com/v1/api/jobs/${settings.adzuna_country}/search/${page + 1}?${params}`;
  const data = await getJson<AdzunaResponse>(url);
  const jobs = data.results.map((j) => {
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
  return { jobs, hasMore: data.results.length === ADZUNA_PAGE_SIZE };
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

const LINKEDIN_PAGE_SIZE = 10;

async function searchLinkedIn(q: SearchQuery, page: number): Promise<SourcePage> {
  const params = new URLSearchParams({ keywords: q.keywords, start: String(page * LINKEDIN_PAGE_SIZE) });
  if (q.maxDays != null) params.set("f_TPR", `r${q.maxDays * 86_400}`); // "posted in the last N seconds"
  if (q.location && !q.remoteOnly) params.set("location", q.location);
  if (q.remoteOnly) params.set("f_WT", "2"); // LinkedIn's "remote" workplace filter
  const doc = await getHtml(`${LINKEDIN_GUEST}/seeMoreJobPostings/search?${params}`);
  const cards = [...doc.querySelectorAll<HTMLElement>("div.base-search-card[data-entity-urn]")];
  const jobs = cards.flatMap((card): JobInput[] => {
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
  return { jobs, hasMore: cards.length === LINKEDIN_PAGE_SIZE };
}

/** Full description of one LinkedIn offer, read from its public posting page. */
export async function fetchLinkedInDescription(externalId: string): Promise<string> {
  const doc = await getHtml(`${LINKEDIN_GUEST}/jobPosting/${encodeURIComponent(externalId)}`);
  const markup = doc.querySelector(".show-more-less-html__markup");
  if (!markup) throw new Error("LinkedIn no mostró la descripción de esta oferta");
  return htmlToText(markup.innerHTML);
}

/** One page of one source. The UI calls each source separately so results show up as they arrive. */
export function searchSource(id: string, q: SearchQuery, settings: AppSettings, page: number): Promise<SourcePage> {
  switch (id) {
    case "remotive": return searchRemotive(q, page);
    case "adzuna": return searchAdzuna(q, settings, page);
    case "linkedin": return searchLinkedIn(q, page);
    default: return Promise.resolve({ jobs: [], hasMore: false });
  }
}
