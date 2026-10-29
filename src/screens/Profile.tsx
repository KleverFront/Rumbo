import { useEffect, useState, type DragEvent } from "react";
import { ACCEPTED_CV_TYPES, extractCvText } from "../cv/extract";
import {
  loadBaseCv, loadProfile, saveBaseCv, saveProfile, uniqueCaseInsensitive,
  type BaseCv, type Education, type Experience, type Language, type Profile, type ProfileField,
} from "../profile";

const PERSONAL: { field: ProfileField; label: string; type?: string; wide?: boolean }[] = [
  { field: "full_name", label: "Nombre completo" },
  { field: "email", label: "Correo", type: "email" },
  { field: "phone", label: "Teléfono", type: "tel" },
  { field: "city", label: "Ciudad" },
  { field: "country", label: "País" },
  { field: "target_role", label: "Cargo objetivo" },
  { field: "headline", label: "Título profesional", wide: true },
  { field: "summary", label: "Resumen", wide: true },
  { field: "salary_expectation", label: "Pretensión salarial" },
  { field: "availability", label: "Disponibilidad" },
  { field: "linkedin_url", label: "LinkedIn", type: "url" },
  { field: "portfolio_url", label: "Portafolio / web", type: "url" },
];

type Col<T> = { key: keyof T & string; label: string; wide?: boolean };

const EXPERIENCE_COLS: Col<Experience>[] = [
  { key: "role", label: "Cargo" }, { key: "company", label: "Empresa" },
  { key: "start_date", label: "Desde" }, { key: "end_date", label: "Hasta" },
  { key: "description", label: "Logros y funciones", wide: true },
];
const EDUCATION_COLS: Col<Education>[] = [
  { key: "degree", label: "Título" }, { key: "institution", label: "Institución" },
  { key: "start_date", label: "Desde" }, { key: "end_date", label: "Hasta" },
];
const LANGUAGE_COLS: Col<Language>[] = [{ key: "language", label: "Idioma" }, { key: "level", label: "Nivel" }];

function blank<T>(cols: Col<T>[]): T {
  return Object.fromEntries(cols.map((c) => [c.key, ""])) as T;
}

function RowsEditor<T extends object>({ title, cols, rows, onChange, addLabel }: {
  title: string; cols: Col<T>[]; rows: T[]; onChange: (rows: T[]) => void; addLabel: string;
}) {
  const set = (i: number, key: keyof T, value: string) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  return (
    <fieldset className="block">
      <legend>{title}</legend>
      {rows.map((row, i) => (
        <div className="row-card" key={i}>
          <div className="grid">
            {cols.map((c) => (
              <label key={c.key} className={c.wide ? "wide" : undefined}>
                <span>{c.label}</span>
                {c.wide ? (
                  <textarea rows={3} value={String(row[c.key] ?? "")} onChange={(e) => set(i, c.key, e.target.value)} />
                ) : (
                  <input value={String(row[c.key] ?? "")} onChange={(e) => set(i, c.key, e.target.value)} />
                )}
              </label>
            ))}
          </div>
          <button type="button" className="link danger" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            Quitar
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, blank(cols)])}>+ {addLabel}</button>
    </fieldset>
  );
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [skillsText, setSkillsText] = useState("");
  const [cv, setCv] = useState<BaseCv | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error" | "busy"; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    Promise.all([loadProfile(), loadBaseCv()])
      .then(([p, c]) => {
        setProfile(p);
        setSkillsText(p.skills.join(", "));
        setCv(c);
      })
      .catch((e) => setStatus({ kind: "error", text: `No se pudo leer el perfil: ${e}` }));
  }, []);

  async function importCv(file: File | undefined) {
    if (!file) return;
    setStatus({ kind: "busy", text: `Leyendo ${file.name}…` });
    try {
      const text = await extractCvText(file);
      if (!text) throw new Error("El archivo no tiene texto seleccionable (¿es una imagen escaneada?).");
      await saveBaseCv(file.name, text);
      setCv(await loadBaseCv());
      setStatus({ kind: "ok", text: `CV importado: ${file.name}` });
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    importCv(e.dataTransfer.files[0]);
  }

  async function onSave() {
    if (!profile) return;
    const next = { ...profile, skills: uniqueCaseInsensitive(skillsText.split(",")) };
    setStatus({ kind: "busy", text: "Guardando…" });
    try {
      await saveProfile(next);
      setProfile(next);
      setSkillsText(next.skills.join(", "));
      setStatus({ kind: "ok", text: "Perfil guardado." });
    } catch (e) {
      setStatus({ kind: "error", text: `No se pudo guardar: ${e}` });
    }
  }

  const update = (patch: Partial<Profile>) => profile && setProfile({ ...profile, ...patch });

  return (
    <section className="profile">
      <h2>Mi perfil y CV base</h2>
      <p className="sub">Su CV y sus datos se guardan solo en esta Mac.</p>

      <label
        className={`drop${dragging ? " over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input type="file" accept={ACCEPTED_CV_TYPES} hidden onChange={(e) => { importCv(e.target.files?.[0]); e.target.value = ""; }} />
        <b>Arrastre aquí su CV en PDF o DOCX</b>
        <small>o haga clic para elegir el archivo</small>
      </label>

      {cv && (
        <details className="cv-text">
          <summary>
            CV base: <b>{cv.name}</b> · {cv.raw_text.length.toLocaleString("es")} caracteres · ver texto extraído
          </summary>
          <pre>{cv.raw_text}</pre>
        </details>
      )}

      {status && <p className={`status ${status.kind}`} role="status">{status.text}</p>}

      {profile && (
        <form onSubmit={(e) => { e.preventDefault(); onSave(); }}>
          <fieldset className="block">
            <legend>Datos personales</legend>
            <div className="grid">
              {PERSONAL.map(({ field, label, type, wide }) => (
                <label key={field} className={wide ? "wide" : undefined}>
                  <span>{label}</span>
                  {field === "summary" ? (
                    <textarea rows={4} value={profile.personal[field]}
                      onChange={(e) => update({ personal: { ...profile.personal, [field]: e.target.value } })} />
                  ) : (
                    <input type={type ?? "text"} value={profile.personal[field]}
                      onChange={(e) => update({ personal: { ...profile.personal, [field]: e.target.value } })} />
                  )}
                </label>
              ))}
            </div>
          </fieldset>

          <RowsEditor title="Experiencia" addLabel="Agregar experiencia" cols={EXPERIENCE_COLS}
            rows={profile.experience} onChange={(experience) => update({ experience })} />
          <RowsEditor title="Estudios" addLabel="Agregar estudio" cols={EDUCATION_COLS}
            rows={profile.education} onChange={(education) => update({ education })} />

          <fieldset className="block">
            <legend>Habilidades</legend>
            <label className="wide">
              <span>Separadas por comas</span>
              <input value={skillsText} placeholder="Python, Odoo, PostgreSQL" onChange={(e) => setSkillsText(e.target.value)} />
            </label>
          </fieldset>

          <RowsEditor title="Idiomas" addLabel="Agregar idioma" cols={LANGUAGE_COLS}
            rows={profile.languages} onChange={(languages) => update({ languages })} />

          <div className="savebar">
            <button type="submit" className="primary" disabled={status?.kind === "busy"}>Guardar perfil</button>
          </div>
        </form>
      )}
    </section>
  );
}
