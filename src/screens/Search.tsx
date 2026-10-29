import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import { saveToPipeline, setJobDescription, upsertJobs, type Job } from "../db";
import { atsScore, matchJob, type MatchResult } from "../match";
import { loadBaseCv, loadProfile } from "../profile";
import { loadSettings, saveSettings, type AppSettings } from "../settings";
import { SOURCES, fetchLinkedInDescription, searchSources, type JobInput } from "../sources";

interface Scored {
  job: Job;
  match: MatchResult;
  ats: number;
}

const SOURCE_LABEL: Record<string, string> = { remotive: "Remotive", adzuna: "Adzuna", linkedin: "LinkedIn", manual: "Agregada a mano" };

function scoreClass(score: number | null) {
  if (score == null) return "score";
  return `score ${score >= 75 ? "s-hi" : score >= 50 ? "s-md" : "s-lo"}`;
}

const EMPTY_MANUAL = { title: "", company: "", location: "", url: "", description: "" };

export default function Search({ onAdapt }: { onAdapt: (jobId: number) => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [cvText, setCvText] = useState("");
  const [keywords, setKeywords] = useState("");
  const [location, setLocation] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [results, setResults] = useState<Scored[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [manual, setManual] = useState<typeof EMPTY_MANUAL | null>(null);
  const [loadingDesc, setLoadingDesc] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([loadSettings(), loadProfile(), loadBaseCv()])
      .then(([s, p, cv]) => {
        setSettings(s);
        setSkills(p.skills);
        setCvText([cv?.raw_text ?? "", p.personal.summary, ...p.experience.map((e) => e.description)].join("\n"));
        setKeywords(p.personal.target_role);
        setLocation(p.personal.city);
      })
      .catch((e) => setNotice(`No se pudo cargar su perfil: ${e}`));
  }, []);

  const enabled = useMemo(() => (settings?.sources ?? "").split(",").filter(Boolean), [settings]);

  function score(jobs: Job[]): Scored[] {
    return jobs.map((job) => {
      const text = `${job.title}\n${job.description ?? ""}`;
      return { job, match: matchJob(text, skills, cvText), ats: atsScore(text, cvText) };
    });
  }

  async function toggleSource(id: string) {
    if (!settings) return;
    const next = enabled.includes(id) ? enabled.filter((s) => s !== id) : [...enabled, id];
    const sources = next.join(",");
    setSettings({ ...settings, sources });
    await saveSettings({ sources });
  }

  async function search() {
    if (!settings || !keywords.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const { jobs, errors } = await searchSources({ keywords: keywords.trim(), location: location.trim(), remoteOnly }, enabled, settings);
      const scored = score(await upsertJobs(jobs)).sort((a, b) => (b.match.score ?? -1) - (a.match.score ?? -1));
      setResults(scored);
      setSelectedId(scored[0]?.job.id ?? null);
      if (scored[0]) ensureDescription(scored[0]);
      const msgs = errors.map((e) => `${SOURCE_LABEL[e.source] ?? e.source}: ${e.message}`);
      if (!scored.length) msgs.unshift("No se encontraron ofertas. Pruebe con otras palabras o active más portales.");
      setNotice(msgs.join(" · ") || null);
    } catch (e) {
      setNotice(`La búsqueda falló: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function addManual() {
    if (!manual || !manual.title.trim() || !manual.description.trim()) return;
    const input: JobInput = {
      source: "manual",
      external_id: manual.url.trim() || crypto.randomUUID(),
      url: manual.url.trim() || null,
      title: manual.title.trim(),
      company: manual.company.trim() || null,
      location: manual.location.trim() || null,
      remote: /remot/i.test(manual.location + manual.description),
      salary_text: null,
      description: manual.description.trim(),
      posted_at: null,
    };
    try {
      const [job] = score(await upsertJobs([input]));
      setResults((r) => [job, ...r.filter((x) => x.job.id !== job.job.id)]);
      setSelectedId(job.job.id);
      setManual(null);
    } catch (e) {
      setNotice(`No se pudo agregar la oferta: ${e}`);
    }
  }

  /** LinkedIn search results come without description; fetch it once, store it and rescore. */
  async function ensureDescription(s: Scored): Promise<Scored> {
    if (s.job.source !== "linkedin" || s.job.description) return s;
    setLoadingDesc(s.job.id);
    try {
      const description = await fetchLinkedInDescription(s.job.external_id);
      await setJobDescription(s.job.id, description);
      const [updated] = score([{ ...s.job, description }]);
      setResults((r) => r.map((x) => (x.job.id === updated.job.id ? updated : x)));
      return updated;
    } catch (e) {
      setNotice(`LinkedIn: ${e instanceof Error ? e.message : e}`);
      return s;
    } finally {
      setLoadingDesc(null);
    }
  }

  function select(s: Scored) {
    setSelectedId(s.job.id);
    ensureDescription(s);
  }

  async function save(s: Scored) {
    try {
      await saveToPipeline(s.job.id, s.match.score);
      setSavedIds((ids) => new Set(ids).add(s.job.id));
    } catch (e) {
      setNotice(`No se pudo guardar la oferta: ${e}`);
    }
  }

  async function adapt(s: Scored) {
    try {
      s = await ensureDescription(s);
      await saveToPipeline(s.job.id, s.match.score);
      onAdapt(s.job.id);
    } catch (e) {
      setNotice(`No se pudo guardar la oferta: ${e}`);
    }
  }

  const selected = results.find((r) => r.job.id === selectedId) ?? null;

  return (
    <section>
      <h2>Buscar ofertas</h2>
      <p className="sub">Un solo buscador para varios portales. Cada oferta se compara con su CV base.</p>

      <form className="search" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input aria-label="Cargo o palabras clave" placeholder="Cargo o palabras clave" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        <input aria-label="Ciudad" placeholder="Ciudad" value={location} disabled={remoteOnly} onChange={(e) => setLocation(e.target.value)} />
        <label className="check"><input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} /> Solo remoto</label>
        <button type="submit" className="primary" disabled={busy || !keywords.trim()}>{busy ? "Buscando…" : "Buscar"}</button>
      </form>

      <div className="chips">
        {SOURCES.map((src) => (
          <button key={src.id} type="button" className={`chip${enabled.includes(src.id) ? " on" : ""}`} aria-pressed={enabled.includes(src.id)} onClick={() => toggleSource(src.id)}>
            {src.label}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => setManual(EMPTY_MANUAL)}>+ Pegar oferta (LinkedIn, Computrabajo…)</button>
      </div>

      {notice && <p className="status error" role="status">{notice}</p>}

      {manual && (
        <fieldset className="block">
          <legend>Agregar oferta a mano</legend>
          <div className="grid">
            <label><span>Cargo *</span><input value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} /></label>
            <label><span>Empresa</span><input value={manual.company} onChange={(e) => setManual({ ...manual, company: e.target.value })} /></label>
            <label><span>Ciudad o «Remoto»</span><input value={manual.location} onChange={(e) => setManual({ ...manual, location: e.target.value })} /></label>
            <label><span>Enlace de la oferta</span><input type="url" value={manual.url} onChange={(e) => setManual({ ...manual, url: e.target.value })} /></label>
            <label className="wide"><span>Descripción completa (cópiela de la página) *</span>
              <textarea rows={6} value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })} />
            </label>
          </div>
          <div className="actions">
            <button type="button" className="primary" disabled={!manual.title.trim() || !manual.description.trim()} onClick={addManual}>Agregar</button>
            <button type="button" onClick={() => setManual(null)}>Cancelar</button>
          </div>
        </fieldset>
      )}

      {!skills.length && !cvText.trim() && (
        <p className="sub">Consejo: importe su CV en «Mi perfil y CV base» para ver qué tan compatible es con cada oferta.</p>
      )}

      {results.length > 0 && (
        <div className="split">
          <div className="list" role="listbox" aria-label="Resultados">
            {results.map((r) => (
              <button key={r.job.id} type="button" role="option" aria-selected={r.job.id === selectedId}
                className={`job${r.job.id === selectedId ? " on" : ""}`} onClick={() => select(r)}>
                <span>
                  <b>{r.job.title}</b>
                  <span className="m">{[r.job.company, r.job.location, SOURCE_LABEL[r.job.source] ?? r.job.source].filter(Boolean).join(" · ")}</span>
                </span>
                <span className={scoreClass(r.match.score)}>{r.match.score == null ? "—" : `${r.match.score}%`}</span>
              </button>
            ))}
          </div>

          {selected && (
            <div className="card detail">
              <h3>{selected.job.title}</h3>
              <div className="meta">{[selected.job.company, selected.job.location, selected.job.salary_text].filter(Boolean).join(" · ")}</div>
              <div className="kpis">
                <div className="kpi"><small>Compatibilidad</small><b>{selected.match.score == null ? "—" : `${selected.match.score}%`}</b></div>
                <div className="kpi"><small>Puntaje ATS</small><b>{selected.ats} / 100</b></div>
              </div>
              {selected.match.matched.length > 0 && (<>
                <div className="lbl">Usted ya cumple</div>
                <div className="tags">{selected.match.matched.map((t) => <span key={t} className="tag t-ok">{t}</span>)}</div>
              </>)}
              {selected.match.missing.length > 0 && (<>
                <div className="lbl">Le falta mostrar</div>
                <div className="tags">{selected.match.missing.map((t) => <span key={t} className="tag t-miss">{t}</span>)}</div>
              </>)}
              <div className="actions">
                <button type="button" className="primary" onClick={() => adapt(selected)}>Adaptar CV</button>
                <button type="button" disabled={savedIds.has(selected.job.id)} onClick={() => save(selected)}>
                  {savedIds.has(selected.job.id) ? "Guardada" : "Guardar"}
                </button>
                {selected.job.url && <button type="button" onClick={() => openUrl(selected.job.url!)}>Abrir oferta</button>}
              </div>
              <div className="lbl">Descripción</div>
              <div className="desc">
                {loadingDesc === selected.job.id ? "Cargando la descripción desde LinkedIn…" : selected.job.description || "Sin descripción."}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
