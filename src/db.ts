import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import type { JobInput } from "./sources";

let db: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  // The URL comes from Rust, where the migrations are registered against it.
  // A failed load is not cached, so the next call retries.
  db ??= invoke<string>("db_url")
    .then((url) => Database.load(url))
    .catch((e) => {
      db = null;
      throw e;
    });
  return db;
}

// Same values as the CHECK constraint on applications.status (001_init.sql).
export const APPLICATION_STATUSES = ["saved", "applied", "interview", "offer", "discarded"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const FOLLOW_UP_DAYS = 7;

export interface Job extends Omit<JobInput, "remote"> {
  id: number;
  remote: number;
}

export interface ApplicationCard {
  id: number;
  job_id: number;
  status: ApplicationStatus;
  match_score: number | null;
  follow_up_at: string | null;
  cv_pdf_path: string | null;
  title: string;
  company: string | null;
  url: string | null;
}

/** company + title + city, lowercased without accents: the same offer posted on several portals. */
export function dedupeKey(j: Pick<JobInput, "company" | "title" | "location">): string {
  const norm = (s: string | null) => (s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\W+/g, " ").trim();
  return [norm(j.company), norm(j.title), norm((j.location ?? "").split(",")[0])].join("|");
}

/** Inserts or refreshes the offers and returns them with their ids, without cross-portal duplicates. */
export async function upsertJobs(jobs: JobInput[]): Promise<Job[]> {
  const d = await getDb();
  const seen = new Set<string>();
  const ids: number[] = [];
  for (const j of jobs) {
    const key = dedupeKey(j);
    if (seen.has(key)) continue;
    seen.add(key);
    const [row] = await d.select<{ id: number }[]>(
      `INSERT INTO jobs (source, external_id, url, title, company, location, remote, salary_text, description, dedupe_key, posted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (source, external_id) DO UPDATE SET
         url = excluded.url, title = excluded.title, company = excluded.company, location = excluded.location,
         remote = excluded.remote, salary_text = excluded.salary_text, description = excluded.description,
         dedupe_key = excluded.dedupe_key, posted_at = excluded.posted_at, fetched_at = datetime('now')
       RETURNING id`,
      [j.source, j.external_id, j.url, j.title, j.company, j.location, j.remote ? 1 : 0, j.salary_text, j.description, key, j.posted_at],
    );
    ids.push(row.id);
  }
  if (!ids.length) return [];
  const rows = await d.select<Job[]>(`SELECT * FROM jobs WHERE id IN (${ids.join(",")})`);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)!);
}

export async function getJob(id: number): Promise<Job | null> {
  const [job] = await (await getDb()).select<Job[]>("SELECT * FROM jobs WHERE id = $1", [id]);
  return job ?? null;
}

/** Offers the user can pick to tailor a CV: everything already in the pipeline, newest first. */
export async function listPipelineJobs(): Promise<Job[]> {
  return (await getDb()).select<Job[]>(
    `SELECT j.* FROM jobs j JOIN applications a ON a.job_id = j.id
      WHERE a.status <> 'discarded' ORDER BY a.updated_at DESC`,
  );
}

export async function listApplications(): Promise<ApplicationCard[]> {
  return (await getDb()).select<ApplicationCard[]>(
    `SELECT a.id, a.job_id, a.status, a.match_score, a.follow_up_at, a.cv_pdf_path, j.title, j.company, j.url
       FROM applications a JOIN jobs j ON j.id = a.job_id
      ORDER BY a.updated_at DESC`,
  );
}

/** Adds the offer to the pipeline as 'saved' (no-op if it is already there). */
export async function saveToPipeline(jobId: number, matchScore: number | null): Promise<void> {
  await (await getDb()).execute(
    "INSERT INTO applications (job_id, match_score) VALUES ($1, $2) ON CONFLICT (job_id) DO NOTHING",
    [jobId, matchScore],
  );
}

export async function setApplicationStatus(id: number, status: ApplicationStatus): Promise<void> {
  // Moving to 'applied' stamps the date and schedules the follow-up reminder.
  await (await getDb()).execute(
    `UPDATE applications SET status = $1,
       applied_at   = CASE WHEN $1 = 'applied' AND applied_at IS NULL THEN datetime('now') ELSE applied_at END,
       follow_up_at = CASE WHEN $1 = 'applied' THEN datetime('now', '+${FOLLOW_UP_DAYS} days')
                           WHEN $1 = 'saved' THEN NULL ELSE follow_up_at END
     WHERE id = $2`,
    [status, id],
  );
}

export async function postponeFollowUp(id: number): Promise<void> {
  await (await getDb()).execute(
    `UPDATE applications SET follow_up_at = datetime('now', '+${FOLLOW_UP_DAYS} days') WHERE id = $1`,
    [id],
  );
}

export async function saveTailoredCv(jobId: number, fields: { cv_json?: string; cv_pdf_path?: string; cover_letter?: string; ats_score?: number }): Promise<void> {
  const d = await getDb();
  await saveToPipeline(jobId, null);
  for (const [col, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    // col comes from the fixed key list of the parameter type, never from user input.
    await d.execute(`UPDATE applications SET ${col} = $1 WHERE job_id = $2`, [value, jobId]);
  }
}

export async function getApplicationByJob(jobId: number): Promise<{ cv_json: string | null; cover_letter: string | null; cv_pdf_path: string | null } | null> {
  const [row] = await (await getDb()).select<{ cv_json: string | null; cover_letter: string | null; cv_pdf_path: string | null }[]>(
    "SELECT cv_json, cover_letter, cv_pdf_path FROM applications WHERE job_id = $1",
    [jobId],
  );
  return row ?? null;
}

export async function dueFollowUps(): Promise<ApplicationCard[]> {
  return (await getDb()).select<ApplicationCard[]>(
    `SELECT a.id, a.job_id, a.status, a.match_score, a.follow_up_at, a.cv_pdf_path, j.title, j.company, j.url
       FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE a.status = 'applied' AND a.follow_up_at <= datetime('now')`,
  );
}
