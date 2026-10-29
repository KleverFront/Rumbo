import { invoke } from "@tauri-apps/api/core";
import { getDb } from "./db";

export type AiProvider = "claude" | "deepseek" | "gemini" | "ollama";
export type SecretName = "anthropic" | "deepseek" | "gemini" | "adzuna";

// Non-secret settings, stored in the settings table. API keys go through the Keychain.
export interface AppSettings {
  ai_provider: AiProvider;
  ai_model: string;
  ai_monthly_limit_usd: string;
  ollama_url: string;
  adzuna_country: string;
  sources: string; // comma-separated enabled source ids
  last_reminder_date: string;
  cv_design_default: string; // JSON CvDesign of the last design used; new offers start from it
}

export const DEFAULT_SETTINGS: AppSettings = {
  ai_provider: "claude",
  ai_model: "claude-opus-5-5",
  ai_monthly_limit_usd: "10",
  ollama_url: "http://localhost:11434",
  adzuna_country: "us",
  sources: "remotive,adzuna,linkedin",
  last_reminder_date: "",
  cv_design_default: "",
};

export async function loadSettings(): Promise<AppSettings> {
  const rows = await (await getDb()).select<{ key: string; value: string | null }[]>("SELECT key, value FROM settings");
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""]));
  return { ...DEFAULT_SETTINGS, ...stored } as AppSettings;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  const d = await getDb();
  for (const [key, value] of Object.entries(patch)) {
    await d.execute(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  }
}

export const getSecret = (name: SecretName) => invoke<string | null>("secret_get", { name });
export const setSecret = (name: SecretName, value: string) => invoke<void>("secret_set", { name, value });
