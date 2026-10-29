# Rumbo

macOS desktop app for job searching: one search across several job portals, local match/ATS scoring against your base CV, AI-tailored CVs and cover letters, and an application pipeline.

Local-first: data lives in SQLite under `~/Library/Application Support/com.rumbo.app/`, API keys in the macOS Keychain, no telemetry.

- Mockup: [`docs/mockup.html`](docs/mockup.html)
- Architecture, tools and roadmap: [`docs/arquitectura.html`](docs/arquitectura.html)

## Features (v1)

- **Profile** — import the base CV (PDF/DOCX), auto-fill the structured profile with AI, edit it by hand.
- **Search** — Remotive (no key) and Adzuna (free key); paste any other offer by hand (LinkedIn, Computrabajo…).
- **Match & ATS** — computed locally per offer: matched/missing skills and keyword coverage.
- **Tailored CV** — AI rewrites the CV for one offer without inventing experience; cover letter; PDF export.
- **Pipeline** — kanban by status; a macOS reminder 7 days after applying.
- **AI providers** — Claude (default `claude-opus-5-5`, server-side refusal fallback on), DeepSeek, Gemini or a local Ollama. Keys in the Keychain; monthly spend limit.

## Setup inside the app

1. *Ajustes* → paste a Claude API key (or pick DeepSeek, Gemini or Ollama). Optional: Adzuna App ID + Key and country.
2. *Mi perfil y CV base* → drop your CV, click *Completar perfil con IA desde el CV*, review, save.
3. *Buscar ofertas* → search, open an offer, *Adaptar CV*, export the PDF.

## Requirements

- Xcode Command Line Tools
- Node.js + pnpm
- Rust (`brew install rustup && rustup default stable`; add `/opt/homebrew/opt/rustup/bin` to `PATH`)

## Development

```sh
pnpm install
pnpm tauri dev
```

Build a `.app` / `.dmg`:

```sh
pnpm tauri build
```

## Layout

- `src/` — React + TypeScript UI
- `src-tauri/` — Rust core (Tauri commands, plugins)
- `src-tauri/migrations/` — SQLite schema, applied on startup by `tauri-plugin-sql`
