import { StyleSheet } from "@react-pdf/renderer";
import { tint, type CvDesign, type TemplateId } from "../design";

// react-pdf does not export its Style type; take it from StyleSheet.create.
export type Style = Parameters<typeof StyleSheet.create>[0][string];

/** Structural variants the shared layout in pdf.tsx switches on. */
export interface Layout {
  /** plain: text + photo; center: photo above a centered name; split: name | contact columns; mono: initials circle. */
  header: "plain" | "center" | "split" | "mono";
  /** Prefix drawn before section titles: a square plus a trailing rule, or a code comment. */
  sectionMarker: "none" | "square" | "code";
  skills: "inline" | "tags" | "lines";
  timeline: boolean;
  sidebar: boolean;
}

const KEYS = [
  "page", "header", "headerText", "name", "headline", "contact", "photo", "mono", "monoText",
  "section", "sectionRow", "sectionSquare", "sectionRule", "summary", "job", "jobHead", "jobTitle",
  "dates", "org", "bullets", "bullet", "dot", "bulletText", "tags", "tag", "skillLine",
  "timelineJob", "timelineDot", "sidebarBg", "columns", "aside", "main", "asideSection",
] as const;
type Sheet = Record<(typeof KEYS)[number], Style>;
type Overrides = Partial<Sheet>;

const SANS = { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique" };
const SERIF = { regular: "Times-Roman", bold: "Times-Bold", italic: "Times-Italic" };
const PAD_X = 44;
const PAD_Y = 40;
const SIDEBAR_W = 170;

// Classic (t-ats in the mockup): every other template is these styles plus overrides.
function base(accent: string, f = SANS): Sheet {
  return {
    page: { paddingTop: PAD_Y, paddingBottom: PAD_Y, paddingHorizontal: PAD_X, fontSize: 10.5, lineHeight: 1.45, fontFamily: f.regular, color: "#1d1d1f" },
    header: { flexDirection: "row", alignItems: "flex-start" },
    headerText: { flex: 1 },
    name: { fontSize: 22, fontFamily: f.bold, lineHeight: 1.2 },
    headline: { fontSize: 12, color: accent, marginTop: 2, marginBottom: 4 },
    contact: { fontSize: 9.5, color: "#555" },
    photo: { width: 64, height: 64, borderRadius: 32, marginLeft: 12, objectFit: "cover" },
    mono: { width: 54, height: 54, borderRadius: 27, backgroundColor: accent, marginRight: 14, alignItems: "center", justifyContent: "center" },
    monoText: { color: "#fff", fontSize: 18, fontFamily: f.bold, letterSpacing: 0.36, lineHeight: 1 },
    section: { fontSize: 11, fontFamily: f.bold, marginTop: 14, marginBottom: 6, paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: "#ccc", textTransform: "uppercase", letterSpacing: 0.44 },
    sectionRow: { flexDirection: "row", alignItems: "center", marginTop: 14, marginBottom: 6 },
    sectionSquare: { width: 8, height: 8, backgroundColor: accent, marginRight: 6 },
    sectionRule: { flex: 1, height: 1, backgroundColor: "#ddd", marginLeft: 6 },
    summary: {},
    job: { marginBottom: 8 },
    jobHead: { flexDirection: "row", alignItems: "flex-start" },
    jobTitle: { flex: 1, fontSize: 10.8, fontFamily: f.bold },
    dates: { flexShrink: 0, marginLeft: 12, fontSize: 9.5, color: "#666", textAlign: "right" },
    org: { color: "#444" },
    bullets: { marginTop: 3 },
    bullet: { flexDirection: "row", marginBottom: 1 },
    dot: { width: 14, paddingLeft: 3 },
    bulletText: { flex: 1 },
    tags: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
    tag: { borderWidth: 1, borderColor: accent, borderRadius: 4, paddingHorizontal: 5, color: accent, fontFamily: "Courier", fontSize: 9 },
    skillLine: {},
    timelineJob: { borderLeftWidth: 2, borderLeftColor: tint(accent, 0.1), paddingLeft: 14, marginLeft: 4, paddingBottom: 4 },
    timelineDot: { position: "absolute", left: -6, top: 3, width: 10, height: 10, borderRadius: 5, backgroundColor: accent },
    sidebarBg: { position: "absolute", top: 0, bottom: 0, left: 0, width: SIDEBAR_W, backgroundColor: tint(accent, 0.1) },
    columns: { flexDirection: "row" },
    aside: { width: SIDEBAR_W, paddingHorizontal: 16 },
    main: { flex: 1 },
    asideSection: {},
  };
}

// Full-width header band: negative margins cancel the page padding so the band touches the edges,
// while the page keeps its top padding for the following pages.
const band = (background: string): Style => ({
  backgroundColor: background, marginTop: -PAD_Y, marginHorizontal: -PAD_X, paddingTop: 26, paddingHorizontal: PAD_X,
});

function overrides(id: TemplateId, accent: string): { layout: Partial<Layout>; styles: Overrides; serif?: boolean } {
  const t = tint(accent, 0.1);
  const accentSection: Style = { color: accent, borderBottomColor: accent };
  switch (id) {
    case "classic":
      return { layout: {}, styles: {} };
    case "modern":
      return {
        layout: {},
        styles: {
          header: { ...band(accent), paddingBottom: 16, marginBottom: 6 },
          name: { color: "#fff" },
          headline: { color: "#fff" },
          contact: { color: "#f2f2f2" },
          photo: { borderWidth: 3, borderColor: "#fff", marginTop: -8 },
          section: { ...accentSection, borderBottomWidth: 2 },
        },
      };
    case "professional":
      return {
        layout: { sectionMarker: "square" },
        styles: {
          headerText: { flex: 1, borderLeftWidth: 5, borderLeftColor: accent, paddingLeft: 12 },
          // The title sits inside sectionRow, which carries the spacing.
          section: { borderBottomWidth: 0, marginTop: 0, marginBottom: 0, paddingBottom: 0 },
        },
      };
    case "minimal":
      return {
        layout: {},
        styles: {
          page: { paddingTop: 56, paddingBottom: 56, paddingHorizontal: 58 },
          name: { fontSize: 28, fontFamily: SANS.regular, letterSpacing: 0.28 },
          headline: { color: "#666", fontSize: 12 },
          section: { borderBottomWidth: 0, color: accent, fontSize: 9.5, letterSpacing: 1.7, marginTop: 22 },
          job: { marginBottom: 12 },
        },
      };
    case "timeline":
      return {
        layout: { timeline: true },
        styles: { section: accentSection },
      };
    case "compact":
      return {
        layout: { header: "split" },
        styles: {
          page: { paddingTop: 30, paddingBottom: 30, paddingHorizontal: 36, fontSize: 10 },
          header: { flexDirection: "row", alignItems: "flex-end", borderBottomWidth: 2, borderBottomColor: accent, paddingBottom: 8 },
          // The name keeps its natural width (no hyphenated names); the contact column shrinks instead.
          headerText: { flexGrow: 1, flexShrink: 0, flexBasis: "auto", maxWidth: "65%" },
          contact: { flexShrink: 1, maxWidth: 210, marginLeft: 12, textAlign: "right" },
          section: { borderBottomWidth: 0, backgroundColor: t, color: accent, paddingVertical: 3, paddingHorizontal: 6, marginTop: 10, marginBottom: 5 },
          job: { marginBottom: 5 },
        },
      };
    case "elegant":
      return {
        serif: true,
        layout: {},
        styles: {
          page: { fontSize: 11 },
          name: { fontSize: 28, fontFamily: SERIF.regular, letterSpacing: 0.84 },
          headline: { fontFamily: SERIF.italic },
          // No small-caps in the built-in fonts: keep the title as written, larger and spaced.
          section: { textTransform: "none", fontSize: 13, fontFamily: SERIF.regular, letterSpacing: 0.78, borderBottomColor: accent },
        },
      };
    case "corporate":
      return {
        layout: {},
        styles: {
          header: { ...band("#f1f2f5"), paddingBottom: 14, marginBottom: 8, borderBottomWidth: 3, borderBottomColor: accent },
          headline: { color: "#333" },
          section: { color: "#555", borderBottomColor: "#ddd" },
        },
      };
    case "tech":
      return {
        layout: { sectionMarker: "code", skills: "tags" },
        styles: {
          name: { letterSpacing: -0.22 },
          headline: { fontFamily: "Courier", fontSize: 10.5 },
          section: { borderBottomWidth: 0, color: accent, fontFamily: "Courier-Bold", textTransform: "none", letterSpacing: 0 },
        },
      };
    case "monogram":
      return {
        layout: { header: "mono" },
        styles: {
          header: { flexDirection: "row", alignItems: "center" },
          section: { color: accent, borderBottomColor: accent, borderBottomStyle: "dotted" },
        },
      };
    case "executive":
      return {
        layout: { header: "center" },
        styles: {
          page: { paddingTop: 52, paddingBottom: 52, paddingHorizontal: 60 },
          header: { flexDirection: "column", alignItems: "center" },
          // The base flex: 1 (basis 0) collapses this box to zero height in a column, overlapping its lines.
          headerText: { flexGrow: 0, flexBasis: "auto", alignSelf: "stretch" },
          name: { fontSize: 24, letterSpacing: 0.48, textAlign: "center" },
          headline: { textAlign: "center" },
          contact: { textAlign: "center" },
          photo: { marginLeft: 0, marginBottom: 8 },
          section: { borderBottomWidth: 0, textAlign: "center", color: accent, letterSpacing: 1.54 },
          summary: { borderLeftWidth: 3, borderLeftColor: accent, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: t },
        },
      };
    case "sidebar":
      return {
        layout: { sidebar: true, skills: "lines" },
        styles: {
          page: { paddingTop: 38, paddingBottom: 38, paddingLeft: 0, paddingRight: 36 },
          main: { flex: 1, marginLeft: 24 },
          section: accentSection,
          asideSection: { marginTop: 0 },
        },
      };
  }
}

export function stylesFor(design: CvDesign): { s: Sheet; layout: Layout } {
  const o = overrides(design.template, design.accent);
  const b = base(design.accent, o.serif ? SERIF : SANS);
  const merged = Object.fromEntries(KEYS.map((k) => [k, { ...b[k], ...o.styles[k] }])) as Sheet;
  return {
    s: StyleSheet.create(merged),
    layout: { header: "plain", sectionMarker: "none", skills: "inline", timeline: false, sidebar: false, ...o.layout },
  };
}
