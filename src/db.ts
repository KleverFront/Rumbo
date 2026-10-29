import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";

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

export type ApplicationStatus = "saved" | "applied" | "interview" | "offer" | "discarded";

export interface ApplicationCard {
  id: number;
  status: ApplicationStatus;
  match_score: number | null;
  title: string;
  company: string | null;
}

export async function listApplications(): Promise<ApplicationCard[]> {
  const d = await getDb();
  return d.select<ApplicationCard[]>(
    `SELECT a.id, a.status, a.match_score, j.title, j.company
       FROM applications a JOIN jobs j ON j.id = a.job_id
      ORDER BY a.updated_at DESC`,
  );
}
