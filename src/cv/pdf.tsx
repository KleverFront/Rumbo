import { Document, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { TailoredCv } from "../ai";
import type { PersonalData } from "../profile";

// Single-column, no tables or images: the layout ATS parsers read most reliably.
const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", lineHeight: 1.4, color: "#1d1d1f" },
  name: { fontSize: 20, fontFamily: "Helvetica-Bold" },
  headline: { fontSize: 11, color: "#2f6fed", marginBottom: 4 },
  contact: { fontSize: 9, color: "#555", marginBottom: 12 },
  section: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4, paddingBottom: 2, borderBottom: "1 solid #ccc" },
  role: { fontFamily: "Helvetica-Bold", marginTop: 6 },
  meta: { color: "#555", fontSize: 9 },
  bullet: { flexDirection: "row", marginLeft: 6 },
  dot: { width: 10 },
  flex: { flex: 1 },
});

function CvDocument({ cv, personal }: { cv: TailoredCv; personal: PersonalData }) {
  const contact = [personal.email, personal.phone, [personal.city, personal.country].filter(Boolean).join(", "), personal.linkedin_url, personal.portfolio_url]
    .filter(Boolean)
    .join("  ·  ");
  return (
    <Document title={`CV ${personal.full_name}`} author={personal.full_name}>
      <Page size="A4" style={s.page}>
        <Text style={s.name}>{personal.full_name}</Text>
        {cv.headline && <Text style={s.headline}>{cv.headline}</Text>}
        {contact && <Text style={s.contact}>{contact}</Text>}

        {cv.summary && <Text>{cv.summary}</Text>}

        {cv.experience.length > 0 && <Text style={s.section}>Experiencia</Text>}
        {cv.experience.map((e, i) => (
          <View key={i} wrap={false}>
            <Text style={s.role}>{e.role} — {e.company}</Text>
            <Text style={s.meta}>{[e.start_date, e.end_date].filter(Boolean).join(" – ")}</Text>
            {e.bullets.map((b, j) => (
              <View key={j} style={s.bullet}>
                <Text style={s.dot}>•</Text>
                <Text style={s.flex}>{b}</Text>
              </View>
            ))}
          </View>
        ))}

        {cv.education.length > 0 && <Text style={s.section}>Estudios</Text>}
        {cv.education.map((e, i) => (
          <View key={i} wrap={false}>
            <Text style={s.role}>{e.degree} — {e.institution}</Text>
            <Text style={s.meta}>{[e.start_date, e.end_date].filter(Boolean).join(" – ")}</Text>
          </View>
        ))}

        {cv.skills.length > 0 && <Text style={s.section}>Habilidades</Text>}
        {cv.skills.length > 0 && <Text>{cv.skills.join(", ")}</Text>}

        {cv.languages.length > 0 && <Text style={s.section}>Idiomas</Text>}
        {cv.languages.length > 0 && <Text>{cv.languages.map((l) => (l.level ? `${l.language} (${l.level})` : l.language)).join(", ")}</Text>}
      </Page>
    </Document>
  );
}

/** Renders the CV, asks where to save it and returns the chosen path (null if cancelled). */
export async function exportCvPdf(cv: TailoredCv, personal: PersonalData, suggestedName: string): Promise<string | null> {
  const path = await save({ defaultPath: `${suggestedName}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!path) return null;
  const blob = await pdf(<CvDocument cv={cv} personal={personal} />).toBlob();
  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  await invoke("save_file", { path, bytes });
  return path;
}

export function safeFileName(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" - ").replace(/[\\/:*?"<>|]+/g, "").slice(0, 120) || "CV";
}
