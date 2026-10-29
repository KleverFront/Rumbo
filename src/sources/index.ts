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

export interface SearchResult {
  jobs: JobInput[];
  errors: { source: string; message: string }[];
}

/** Queries every enabled source in parallel; one failing source does not hide the others. */
export async function searchSources(q: SearchQuery, enabled: string[], settings: AppSettings): Promise<SearchResult> {
  const runners: Record<string, () => Promise<JobInput[]>> = {
    remotive: () => searchRemotive(q),
    adzuna: () => searchAdzuna(q, settings),
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
