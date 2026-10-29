# Xolva-inspired improvements

Objective: reuse what Xolva does well and extend it. Branch: `main` (user commits). Delivery: user commits each slice. Tests: `pnpm test` (Node runner) only on request.

## Specs

- **S1 — AI search strategy ("rings").** User: "Búsqueda con IA (anillos)". AI generates 4 queries from most specific to broadest for the target role (from profile + CV); the app runs them in order across enabled sources until a quota of offers is reached, skipping offers already shown/seen; each result shows which ring found it. Includes automatic retries for non-Claude providers on saturation/5xx.
- **S2 — CV modes + ask for changes.** User: "Modos de CV + pedir cambios". Modes Suave (polish/translate, titles unchanged), Equilibrado (ATS keywords, default), Profundo (may adapt job titles, must be reviewed). A free-text box applies an instruction to the current tailored CV without regenerating it from scratch. No invention rule stays in every mode.
- **S3 — Work mode + hide seen.** User: "Modalidad y ocultar vistas". Filter Remoto / Híbrido / Presencial (replaces "Solo remoto"). Option to hide offers already opened or already in the pipeline.
- **S4 — Embedded browser.** User: "Navegador integrado". Indeed, Computrabajo and Multitrabajos open inside Rumbo; the user browses normally (no automation, no bot-detection evasion) and an "Importar esta oferta" button sends title, company, location, URL and description to Rumbo as a job.

## Tasks

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T1 | S3 | inline | done (tsc ok; migration 003 `jobs.seen_at`) | staged, user commits |
| T2 | S2 | inline | done (tsc ok) | staged, user commits |
| T3 | S1 | inline | done (tsc ok; retries for DeepSeek/Gemini/Ollama) | staged, user commits |
| T4 | S4 | delegated (parallel unit: Rust window + new screen, disjoint files) | done (tsc + cargo check ok; Rust unit tests written, not run) | staged, user commits |

## Log

- L1 (2026-10-29, user, verbatim): "lsito mira mas portales de la que estabamos analisando y mira que otras mejoras podemos usar de ellos?" → chose all four: "Búsqueda con IA (anillos), Modos de CV + pedir cambios, Modalidad y ocultar vistas, Navegador integrado, si la idea es aprovechar su trabajo y expandirlo a cosas nuestras que se nos ocurran".
- L2 (2026-10-29): probes — Indeed EC 403 Cloudflare, InfoJobs 405 challenge, Computrabajo 403, Multitrabajos 403 Cloudflare (HTML and internal API). Only LinkedIn guest search answers plain HTTP. Decision: no evasion; S4 embedded browser driven by the user instead.
- L3 (2026-10-29): T1–T3 implemented inline. LinkedIn work mode via `f_WT` (1 presencial, 2 remoto, 3 híbrido); Adzuna has no work-mode filter, so it requires mode words (`what_or`); Remotive is skipped for híbrido/presencial. Rings: AI returns 4 plain keyword queries (no boolean operators, since the portals do not share a syntax), run sequentially until the quota. No tests run (user rule); `tsc --noEmit` clean.
- L4 (2026-10-29): T4 delivered by a bounded writer. Portal window = `WebviewWindowBuilder` with an injected "Importar esta oferta a Rumbo" button; the page sends data by navigating to `rumbo-import://job?data=…`, which `on_navigation` cancels, validates (serde, length caps) and emits as `browser-import` to `main` — no remote IPC capability. Extraction reads JobPosting JSON-LD, then h1/og meta. Not verified: that the 3 portals publish JobPosting JSON-LD (unreachable by curl). Parent wired it as "Otros portales" (kept mounted while hidden).
