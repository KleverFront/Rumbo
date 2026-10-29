import { useEffect, useRef, useState } from "react";
import { CV_MODES, adaptCv, coverLetter, reviseCv, tailoredCvText, toTailoredCv, type CvMode, type TailoredCv } from "../ai";
import { exportCvPdf, safeFileName } from "../cv/pdf";
import { getApplicationByJob, getJob, listPipelineJobs, saveTailoredCv, type Job } from "../db";
import { atsScore } from "../match";
import { loadBaseCv, loadProfile, type BaseCv, type Profile } from "../profile";

export default function AdaptCv({ jobId, onPickJob }: { jobId: number | null; onPickJob: (id: number) => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [baseCv, setBaseCv] = useState<BaseCv | null>(null);
  const [cv, setCv] = useState<TailoredCv | null>(null);
  const [letter, setLetter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<CvMode>("balanced");
  const [instruction, setInstruction] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // Results that arrive after the user picked another offer are dropped.
  const currentJob = useRef(jobId);
  currentJob.current = jobId;

  useEffect(() => {
    Promise.all([listPipelineJobs(), loadProfile(), loadBaseCv()])
      .then(([j, p, c]) => { setJobs(j); setProfile(p); setBaseCv(c); })
      .catch((e) => setStatus({ kind: "error", text: String(e) }));
  }, []);

  useEffect(() => {
    setCv(null);
    setLetter("");
    setStatus(null);
    if (jobId == null) return setJob(null);
    Promise.all([getJob(jobId), getApplicationByJob(jobId)])
      .then(([j, a]) => {
        if (currentJob.current !== jobId) return;
        setJob(j);
        if (a?.cv_json) setCv(toTailoredCv(JSON.parse(a.cv_json)));
        setLetter(a?.cover_letter ?? "");
      })
      .catch((e) => setStatus({ kind: "error", text: `No se pudo cargar la oferta: ${e}` }));
  }, [jobId]);

  const baseText = [baseCv?.raw_text ?? "", profile?.personal.summary ?? "", ...(profile?.experience.map((e) => e.description) ?? [])].join("\n");
  const jobText = job ? `${job.title}\n${job.description ?? ""}` : "";
  const hasData = !!baseCv || !!profile?.experience.length;

  /** Runs fn for the current offer; returns undefined on error or if the user switched offers meanwhile. */
  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    const startedFor = currentJob.current;
    setBusy(label);
    setStatus(null);
    try {
      const result = await fn();
      return currentJob.current === startedFor ? result : undefined;
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    if (!job || !profile) return;
    const result = await run("Adaptando su CV…", () => adaptCv(profile, baseCv?.raw_text ?? "", job, mode));
    if (!result) return;
    setLetter("");
    await keep(result);
  }

  async function keep(result: TailoredCv) {
    if (!job) return;
    setCv(result);
    await run("Guardando…", () =>
      saveTailoredCv(job.id, { cv_json: JSON.stringify(result), ats_score: atsScore(jobText, tailoredCvText(result)) }));
  }

  async function applyChange() {
    if (!job || !profile || !cv || !instruction.trim()) return;
    const result = await run("Aplicando su cambio…", () => reviseCv(profile, cv, job, instruction.trim()));
    if (!result) return;
    setInstruction("");
    await keep(result);
  }

  const modePicker = (
    <label className="mode">
      <span>Modo de adaptación</span>
      <select value={mode} onChange={(e) => setMode(e.target.value as CvMode)}>
        {CV_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <small>{CV_MODES.find((m) => m.id === mode)?.hint}</small>
    </label>
  );

  async function makeLetter() {
    if (!job || !profile || !cv) return;
    const result = await run("Escribiendo la carta…", () => coverLetter(profile, cv, job));
    if (result === undefined) return;
    setLetter(result);
    await run("Guardando…", () => saveTailoredCv(job.id, { cover_letter: result }));
  }

  async function exportPdf() {
    if (!job || !profile || !cv) return;
    const path = await run("Generando PDF…", () =>
      exportCvPdf(cv, profile.personal, safeFileName("CV", profile.personal.full_name, job.company, job.title)),
    );
    if (!path) return;
    await run("Guardando…", () => saveTailoredCv(job.id, { cv_pdf_path: path }));
    setStatus({ kind: "ok", text: `PDF guardado en ${path}` });
  }

  return (
    <section>
      <h2>Adaptar CV</h2>
      <p className="sub">La IA solo reorganiza y resalta lo que ya está en su CV; no inventa experiencia.</p>

      <label className="pick">
        <span>Oferta</span>
        <select value={jobId ?? ""} onChange={(e) => e.target.value && onPickJob(Number(e.target.value))}>
          <option value="">Elija una oferta guardada…</option>
          {job && !jobs.some((j) => j.id === job.id) && <option value={job.id}>{job.title}</option>}
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}{j.company ? ` — ${j.company}` : ""}</option>)}
        </select>
      </label>

      {!hasData && <p className="status error">Primero importe su CV en «Mi perfil y CV base».</p>}
      {status && <p className={`status ${status.kind}`} role="status">{status.text}</p>}
      {busy && <p className="status busy" role="status">{busy}</p>}

      {job && hasData && !cv && (
        <div className="empty">
          <p>Genere un CV adaptado a <b>{job.title}</b>{job.company ? ` en ${job.company}` : ""}.</p>
          {modePicker}
          <button type="button" className="primary" disabled={!!busy} onClick={generate}>Adaptar CV</button>
        </div>
      )}

      {job && cv && (
        <div className="cvgrid">
          <div className="doc">
            <h4>CV base</h4>
            <pre>{baseCv?.raw_text || "(sin CV importado; se usó su perfil)"}</pre>
          </div>
          <div className="doc">
            <h4>CV adaptado</h4>
            <p><b>{cv.headline}</b></p>
            <p>{cv.summary}</p>
            {cv.experience.map((e, i) => (
              <div key={i}>
                <p className="role">{e.role} — {e.company} <small>{[e.start_date, e.end_date].filter(Boolean).join(" – ")}</small></p>
                <ul>{e.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>
              </div>
            ))}
            {cv.education.map((e, i) => <p key={i}>{e.degree} — {e.institution}</p>)}
            <p><b>Habilidades:</b> {cv.skills.join(", ")}</p>
            {cv.languages.length > 0 && <p><b>Idiomas:</b> {cv.languages.map((l) => `${l.language} (${l.level})`).join(", ")}</p>}
          </div>
          <div className="card">
            <div className="kpis two">
              <div className="kpi"><small>ATS antes</small><b>{atsScore(jobText, baseText)}</b></div>
              <div className="kpi"><small>ATS después</small><b className="ok">{atsScore(jobText, tailoredCvText(cv))}</b></div>
            </div>
            {cv.keywords_added.length > 0 && (<>
              <div className="lbl">Palabras clave agregadas</div>
              <div className="tags">{cv.keywords_added.map((k) => <span key={k} className="tag t-ok">{k}</span>)}</div>
            </>)}
            {cv.suggestions.length > 0 && (<>
              <div className="lbl">Sugerencias</div>
              <ul className="small">{cv.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </>)}
            <div className="actions">
              <button type="button" className="primary" disabled={!!busy} onClick={exportPdf}>Exportar PDF</button>
              <button type="button" disabled={!!busy} onClick={makeLetter}>Carta de presentación</button>
            </div>
            <div className="lbl">Pedir cambios</div>
            <textarea rows={3} placeholder="Ej.: resalte más mi experiencia con Odoo y acorte el resumen"
              value={instruction} onChange={(e) => setInstruction(e.target.value)} />
            <div className="actions">
              <button type="button" disabled={!!busy || !instruction.trim()} onClick={applyChange}>Aplicar cambios</button>
            </div>
            <div className="lbl">Regenerar desde cero</div>
            {modePicker}
            <div className="actions">
              <button type="button" disabled={!!busy} onClick={generate}>Regenerar</button>
            </div>
          </div>
        </div>
      )}

      {letter && (
        <fieldset className="block letter">
          <legend>Carta de presentación</legend>
          <textarea rows={12} value={letter} onChange={(e) => setLetter(e.target.value)}
            onBlur={() => job && saveTailoredCv(job.id, { cover_letter: letter })} />
          <div className="actions">
            <button type="button" onClick={() => navigator.clipboard.writeText(letter)}>Copiar</button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
