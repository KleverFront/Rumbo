# CV designs

Objective: 12 PDF templates + a «Diseño» tab with live preview, as approved in `docs/mockup-disenos.html`; fix overlapping text in the PDF. Branch `main` (user commits). Tests only on request.

## Specs

- **S1 — 12 templates in the real PDF.** User: "ofrece al menos 10 diseños modernos que cumplan con los requerimientos formales y agradables un poco también" → approved mockup ("si me agrada y vamos a implementar"). Templates and wording exactly as `src/cv/design.ts` `TEMPLATES` (10 ATS-compatible, 2 "para correo"). Accent color (8), optional photo, A4/Carta, headings language (auto/es/en).
- **S2 — No overlapping text.** User: "al momento de generar hay algunas cosas que se enciman". Dates on the job title line (right-aligned), long blocks may break across pages without colliding.
- **S3 — «Diseño» tab in Adaptar CV.** Tabs Contenido / Diseño / Carta de presentación; template grid with thumbnails of the real PDF, ATS filter, accent swatches, photo, paper, headings language, live preview of the real PDF, export. The design is remembered per offer; the last one used is the default for new offers.

## Tasks

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T1 | S1, S2 | delegated (parallel unit: `src/cv/pdf.tsx` + `src/cv/templates/`) | done (tsc ok; 12 templates rendered in Node and inspected, A4 + Carta, with/without photo) | staged, user commits |
| T2 | S3 | inline (UI, preview, persistence, migration 004, photo) | done (tsc + cargo check ok) | staged, user commits |

## Log

- L1 (2026-10-29, user, verbatim): "al momento de generar hay algunas cosas que se enciman crees que improte el disenño del pdf tambien?? o eso generalmente no? tu qeu dces para esto" → "crees que denerimoa hacer como un apartado para disenños o algo asi?" → "si me gusta aofrece al menos 10disenños modernos que cumplan con los requirimientos fmormales y agradbles un pco tabien" → "si me grada y vamos a implemtanr".
- L2: contract fixed in `src/cv/design.ts` (TemplateId, CvDesign, ACCENTS, tint, sectionLabels). PDF API: `renderCvPdf(cv, personal, design, photo) → Blob`, `exportCvPdf(cv, personal, design, photo, name) → path | null`.
- L3 (2026-10-29, user, verbatim): "si pide foto es de que pongas un apartado pra subirla como tal" → «Foto para el CV» block in the profile (upload/change/remove, center-cropped 400 px JPEG) plus «Subir foto» inside the Diseño tab when the photo switch is on.
- L4: overlap root causes found while rendering: whole entries in `wrap={false}`; a `flex: 1` box inside a column collapsing to zero height (executive header); section titles split and stranded at a page end (fixed with `wrap={false}` + `minPresenceAhead`). Preview draws the generated PDF with pdfjs into canvases (WKWebView inline PDF not relied on). No tests run (user rule).
