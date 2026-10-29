import { getDb } from "./db";

// Field names match the profile* tables in src-tauri/migrations/001_init.sql.
export const PROFILE_FIELDS = [
  "full_name", "email", "phone", "city", "country", "headline", "summary",
  "target_role", "salary_expectation", "availability", "linkedin_url", "portfolio_url",
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type PersonalData = Record<ProfileField, string>;

export interface Experience { company: string; role: string; start_date: string; end_date: string; description: string }
export interface Education { institution: string; degree: string; start_date: string; end_date: string }
export interface Language { language: string; level: string }

export interface Profile {
  personal: PersonalData;
  experience: Experience[];
  education: Education[];
  skills: string[];
  languages: Language[];
}

export interface BaseCv { name: string; raw_text: string; created_at: string }

// SELECT returns NULL for empty columns; the form works with strings.
function strings<T extends object>(row: T): T {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v ?? ""])) as T;
}

export async function loadProfile(): Promise<Profile> {
  const d = await getDb();
  const [personal] = await d.select<PersonalData[]>(`SELECT ${PROFILE_FIELDS.join(", ")} FROM profile WHERE id = 1`);
  const experience = await d.select<Experience[]>(
    "SELECT company, role, start_date, end_date, description FROM profile_experience ORDER BY sort",
  );
  const education = await d.select<Education[]>(
    "SELECT institution, degree, start_date, end_date FROM profile_education ORDER BY sort",
  );
  const skills = await d.select<{ name: string }[]>("SELECT name FROM profile_skills ORDER BY id");
  const languages = await d.select<Language[]>("SELECT language, level FROM profile_languages ORDER BY id");
  return {
    personal: strings(personal),
    experience: experience.map(strings),
    education: education.map(strings),
    skills: skills.map((s) => s.name),
    languages: languages.map(strings),
  };
}

const blankToNull = (v: string) => (v.trim() === "" ? null : v.trim());

export async function saveProfile(p: Profile): Promise<void> {
  const d = await getDb();
  // shortcut: lists are replaced with delete + insert and no transaction (the SQL plugin
  // pools connections); fine for one local user, move to a Rust command if it ever matters.
  await d.execute(
    `UPDATE profile SET ${PROFILE_FIELDS.map((f, i) => `${f} = $${i + 1}`).join(", ")} WHERE id = 1`,
    PROFILE_FIELDS.map((f) => blankToNull(p.personal[f])),
  );

  await d.execute("DELETE FROM profile_experience");
  for (const [i, e] of p.experience.filter((e) => e.company.trim() || e.role.trim()).entries()) {
    await d.execute(
      "INSERT INTO profile_experience (company, role, start_date, end_date, description, sort) VALUES ($1, $2, $3, $4, $5, $6)",
      [e.company.trim(), e.role.trim(), blankToNull(e.start_date), blankToNull(e.end_date), blankToNull(e.description), i],
    );
  }

  await d.execute("DELETE FROM profile_education");
  for (const [i, e] of p.education.filter((e) => e.institution.trim() || e.degree.trim()).entries()) {
    await d.execute(
      "INSERT INTO profile_education (institution, degree, start_date, end_date, sort) VALUES ($1, $2, $3, $4, $5)",
      [e.institution.trim(), e.degree.trim(), blankToNull(e.start_date), blankToNull(e.end_date), i],
    );
  }

  await d.execute("DELETE FROM profile_skills");
  for (const name of uniqueCaseInsensitive(p.skills)) {
    await d.execute("INSERT INTO profile_skills (name) VALUES ($1)", [name]);
  }

  await d.execute("DELETE FROM profile_languages");
  const seen = new Set<string>();
  for (const l of p.languages) {
    const key = l.language.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    await d.execute("INSERT INTO profile_languages (language, level) VALUES ($1, $2)", [l.language.trim(), blankToNull(l.level)]);
  }
}

export function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  return values
    .map((v) => v.trim())
    .filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
}

export async function loadBaseCv(): Promise<BaseCv | null> {
  const d = await getDb();
  const [cv] = await d.select<BaseCv[]>("SELECT name, raw_text, created_at FROM cvs WHERE is_base = 1 LIMIT 1");
  return cv ?? null;
}

/** Stores an imported CV as the new base CV; previous imports are kept but no longer base. */
export async function saveBaseCv(fileName: string, rawText: string): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE cvs SET is_base = 0 WHERE is_base = 1");
  await d.execute("INSERT INTO cvs (name, source_file, raw_text, is_base) VALUES ($1, $2, $3, 1)", [fileName, fileName, rawText]);
}

/** Profile photo for the CV as a small JPEG data URL, or null. Kept apart from Profile so autosave never rewrites it. */
export async function loadPhoto(): Promise<string | null> {
  const [row] = await (await getDb()).select<{ photo: string | null }[]>("SELECT photo FROM profile WHERE id = 1");
  return row?.photo ?? null;
}

export async function savePhoto(dataUrl: string | null): Promise<void> {
  await (await getDb()).execute("UPDATE profile SET photo = $1 WHERE id = 1", [dataUrl]);
}
