import { Document, Image, Page, Text, View, pdf } from "@react-pdf/renderer";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { TailoredCv } from "../ai";
import type { PersonalData } from "../profile";
import { sectionLabels, type CvDesign, type SectionLabels } from "./design";
import { stylesFor, type Layout, type Style } from "./templates/styles";

type Sheet = ReturnType<typeof stylesFor>["s"];

// Keeps a section title from being stranded at the bottom of a page. Titles also need wrap={false}:
// a padded one-line Text that barely overflows is "split" and stays behind alone.
const KEEP_WITH_NEXT = 32;

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

function period(start: string, end: string, present: string): string {
  if (start && !end) return `${start} – ${present}`;
  return [start, end].filter(Boolean).join(" – ");
}

function SectionTitle({ s, layout, title, style }: { s: Sheet; layout: Layout; title: string; style?: Style }) {
  if (layout.sectionMarker === "square")
    return (
      <View style={s.sectionRow} wrap={false} minPresenceAhead={KEEP_WITH_NEXT}>
        <View style={s.sectionSquare} />
        <Text style={s.section}>{title}</Text>
        <View style={s.sectionRule} />
      </View>
    );
  return (
    <Text style={style ? [s.section, style] : s.section} wrap={false} minPresenceAhead={KEEP_WITH_NEXT}>
      {layout.sectionMarker === "code" ? `// ${title}` : title}
    </Text>
  );
}

function Bullet({ s, text }: { s: Sheet; text: string }) {
  return (
    <View style={s.bullet}>
      <Text style={s.dot}>•</Text>
      <Text style={s.bulletText}>{text}</Text>
    </View>
  );
}

// Title and dates share a row: the title wraps inside its own box, the dates never shrink.
function EntryHead({ s, title, dates, org }: { s: Sheet; title: string; dates: string; org: string }) {
  return (
    <>
      <View style={s.jobHead}>
        <Text style={s.jobTitle}>{title}</Text>
        {dates && <Text style={s.dates}>{dates}</Text>}
      </View>
      {org && <Text style={s.org}>{org}</Text>}
    </>
  );
}

function Experience({ s, layout, e, present }: { s: Sheet; layout: Layout; e: TailoredCv["experience"][number]; present: string }) {
  const [first, ...rest] = e.bullets;
  return (
    <View style={layout.timeline ? [s.job, s.timelineJob] : s.job}>
      {layout.timeline && <View style={s.timelineDot} />}
      {/* Only the header and first bullet stay together; the rest may break across pages. */}
      <View wrap={false}>
        <EntryHead s={s} title={e.role} dates={period(e.start_date, e.end_date, present)} org={e.company} />
        {first && <View style={s.bullets}><Bullet s={s} text={first} /></View>}
      </View>
      {rest.map((b, j) => <Bullet key={j} s={s} text={b} />)}
    </View>
  );
}

function Skills({ s, layout, skills }: { s: Sheet; layout: Layout; skills: string[] }) {
  if (layout.skills === "tags")
    return <View style={s.tags}>{skills.map((k, i) => <Text key={i} style={s.tag}>{k}</Text>)}</View>;
  if (layout.skills === "lines") return <>{skills.map((k, i) => <Text key={i} style={s.skillLine}>{k}</Text>)}</>;
  return <Text>{skills.join(", ")}</Text>;
}

function Header({ s, layout, personal, headline, photo }: { s: Sheet; layout: Layout; personal: PersonalData; headline: string; photo: string | null }) {
  const contact = [personal.email, personal.phone, [personal.city, personal.country].filter(Boolean).join(", "), personal.linkedin_url, personal.portfolio_url]
    .filter(Boolean)
    .join(" · ");
  const img = photo && <Image src={photo} style={s.photo} />;
  if (layout.header === "center")
    return (
      <View style={s.header}>
        {img}
        <View style={s.headerText}>
          <Text style={s.name}>{personal.full_name}</Text>
          {headline && <Text style={s.headline}>{headline}</Text>}
          {contact && <Text style={s.contact}>{contact}</Text>}
        </View>
      </View>
    );
  const split = layout.header === "split";
  return (
    <View style={s.header}>
      {layout.header === "mono" && !photo && (
        <View style={s.mono}><Text style={s.monoText}>{initials(personal.full_name)}</Text></View>
      )}
      <View style={s.headerText}>
        <Text style={s.name}>{personal.full_name}</Text>
        {headline && <Text style={s.headline}>{headline}</Text>}
        {!split && contact && <Text style={s.contact}>{contact}</Text>}
      </View>
      {split && contact && <Text style={s.contact}>{contact}</Text>}
      {img}
    </View>
  );
}

function CvDocument({ cv, personal, design, photo }: { cv: TailoredCv; personal: PersonalData; design: CvDesign; photo: string | null }) {
  const { s, layout } = stylesFor(design);
  const labels: SectionLabels = sectionLabels(design.headingsLang, [cv.summary, ...cv.experience.flatMap((e) => e.bullets)].join(" "));
  const shownPhoto = design.photo ? photo : null;
  const languages = cv.languages.map((l) => (l.level ? `${l.language} (${l.level})` : l.language)).join(" · ");

  const main = (
    <>
      {cv.summary && <SectionTitle s={s} layout={layout} title={labels.profile} />}
      {cv.summary && <View style={s.summary}><Text>{cv.summary}</Text></View>}

      {cv.experience.length > 0 && <SectionTitle s={s} layout={layout} title={labels.experience} />}
      {cv.experience.map((e, i) => <Experience key={i} s={s} layout={layout} e={e} present={labels.present} />)}

      {cv.education.length > 0 && <SectionTitle s={s} layout={layout} title={labels.education} />}
      {cv.education.map((e, i) => (
        <View key={i} style={s.job} wrap={false}>
          <EntryHead s={s} title={e.degree} dates={period(e.start_date, e.end_date, labels.present)} org={e.institution} />
        </View>
      ))}
    </>
  );
  const side = (first: boolean) => (
    <>
      {cv.skills.length > 0 && <SectionTitle s={s} layout={layout} title={labels.skills} style={first ? s.asideSection : undefined} />}
      {cv.skills.length > 0 && <Skills s={s} layout={layout} skills={cv.skills} />}
      {languages && <SectionTitle s={s} layout={layout} title={labels.languages} style={first && !cv.skills.length ? s.asideSection : undefined} />}
      {languages && <Text>{languages}</Text>}
    </>
  );
  const header = <Header s={s} layout={layout} personal={personal} headline={cv.headline} photo={shownPhoto} />;

  return (
    <Document title={`CV ${personal.full_name}`} author={personal.full_name}>
      <Page size={design.paper} style={s.page}>
        {layout.sidebar ? (
          <>
            {/* Tinted column behind the aside, repeated on every page at full height. */}
            <View fixed style={s.sidebarBg} />
            <View style={s.columns}>
              <View style={s.aside}>{side(true)}</View>
              <View style={s.main}>
                {header}
                {main}
              </View>
            </View>
          </>
        ) : (
          <>
            {header}
            {main}
            {side(false)}
          </>
        )}
      </Page>
    </Document>
  );
}

export async function renderCvPdf(cv: TailoredCv, personal: PersonalData, design: CvDesign, photo: string | null): Promise<Blob> {
  return pdf(<CvDocument cv={cv} personal={personal} design={design} photo={photo} />).toBlob();
}

/** Renders the CV, asks where to save it and returns the chosen path (null if cancelled). */
export async function exportCvPdf(cv: TailoredCv, personal: PersonalData, design: CvDesign, photo: string | null, suggestedName: string): Promise<string | null> {
  const path = await save({ defaultPath: `${suggestedName}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!path) return null;
  const blob = await renderCvPdf(cv, personal, design, photo);
  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  await invoke("save_file", { path, bytes });
  return path;
}

export function safeFileName(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" - ").replace(/[\\/:*?"<>|]+/g, "").slice(0, 120) || "CV";
}
