# Rumbo

macOS desktop app for job searching: one search across several job portals, local match/ATS scoring against your base CV, AI-tailored CVs and cover letters, and an application pipeline.

Local-first: data lives in SQLite under `~/Library/Application Support/com.rumbo.app/`, API keys in the macOS Keychain, no telemetry.

- Mockup: [`docs/mockup.html`](docs/mockup.html)
- Architecture, tools and roadmap: [`docs/arquitectura.html`](docs/arquitectura.html)

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
