// Shared contract between the Diseño tab (UI) and the PDF templates (pdf.tsx).

export type TemplateId =
  | "classic" | "modern" | "professional" | "minimal" | "timeline" | "compact"
  | "elegant" | "corporate" | "tech" | "monogram" | "executive" | "sidebar";

export interface TemplateInfo {
  id: TemplateId;
  name: string;
  description: string;
  /** Single column with real text: safe for applicant tracking systems. */
  ats: boolean;
}

// Same order and wording as docs/mockup-disenos.html.
export const TEMPLATES: TemplateInfo[] = [
  { id: "classic", name: "Clásica", description: "Una columna, sobria. La más segura para portales.", ats: true },
  { id: "modern", name: "Moderna", description: "Encabezado de color, fechas a la derecha.", ats: true },
  { id: "professional", name: "Profesional", description: "Barra de color junto al nombre y títulos con marca.", ats: true },
  { id: "minimal", name: "Minimalista", description: "Mucho aire, nombre fino y títulos espaciados.", ats: true },
  { id: "timeline", name: "Línea de tiempo", description: "La experiencia como una línea con hitos.", ats: true },
  { id: "compact", name: "Compacta", description: "Aprovecha la hoja: ideal para mucha experiencia.", ats: true },
  { id: "elegant", name: "Elegante", description: "Tipografía con serifa, estilo editorial.", ats: true },
  { id: "corporate", name: "Corporativa", description: "Encabezado gris con línea de color. Muy formal.", ats: true },
  { id: "tech", name: "Tecnológica", description: "Habilidades como etiquetas, toques de código.", ats: true },
  { id: "monogram", name: "Monograma", description: "Iniciales en un círculo de color.", ats: true },
  { id: "executive", name: "Ejecutiva", description: "Centrada y con resumen destacado.", ats: false },
  { id: "sidebar", name: "Barra lateral", description: "Columna de color con habilidades e idiomas.", ats: false },
];

export const ACCENTS: { hex: string; name: string }[] = [
  { hex: "#2f6fed", name: "Azul" },
  { hex: "#1e3a8a", name: "Azul marino" },
  { hex: "#0f766e", name: "Verde azulado" },
  { hex: "#15803d", name: "Verde" },
  { hex: "#7c3aed", name: "Violeta" },
  { hex: "#9f1239", name: "Vino" },
  { hex: "#b45309", name: "Ámbar" },
  { hex: "#334155", name: "Gris pizarra" },
];

export type Paper = "A4" | "LETTER";
export type HeadingsLang = "auto" | "es" | "en";

export interface CvDesign {
  template: TemplateId;
  accent: string;
  photo: boolean;
  paper: Paper;
  headingsLang: HeadingsLang;
}

export const DEFAULT_DESIGN: CvDesign = { template: "classic", accent: "#2f6fed", photo: false, paper: "A4", headingsLang: "auto" };

/** Parses a stored design, falling back field by field so an old or broken value never breaks export. */
export function toDesign(raw: unknown): CvDesign {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<CvDesign>;
  return {
    template: TEMPLATES.some((t) => t.id === r.template) ? r.template! : DEFAULT_DESIGN.template,
    accent: typeof r.accent === "string" && /^#[0-9a-f]{6}$/i.test(r.accent) ? r.accent : DEFAULT_DESIGN.accent,
    photo: r.photo === true,
    paper: r.paper === "LETTER" ? "LETTER" : "A4",
    headingsLang: r.headingsLang === "es" || r.headingsLang === "en" ? r.headingsLang : "auto",
  };
}

/** The accent mixed with white; react-pdf has no color-mix(). amount 0.1 = 10% accent. */
export function tint(hex: string, amount = 0.1): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(255 - (255 - c) * amount).toString(16).padStart(2, "0");
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

export interface SectionLabels {
  profile: string; experience: string; education: string; skills: string; languages: string; present: string;
}

const LABELS: Record<"es" | "en", SectionLabels> = {
  es: { profile: "Perfil", experience: "Experiencia", education: "Estudios", skills: "Habilidades", languages: "Idiomas", present: "actualidad" },
  en: { profile: "Profile", experience: "Experience", education: "Education", skills: "Skills", languages: "Languages", present: "present" },
};

/** "auto" follows the CV text: Spanish unless it reads as English. */
export function sectionLabels(lang: HeadingsLang, sampleText: string): SectionLabels {
  if (lang !== "auto") return LABELS[lang];
  const words = sampleText.toLowerCase().match(/\b(the|and|with|for|of|to)\b/g)?.length ?? 0;
  const palabras = sampleText.toLowerCase().match(/\b(el|la|los|las|y|con|para|de|en)\b/g)?.length ?? 0;
  return LABELS[words > palabras ? "en" : "es"];
}
