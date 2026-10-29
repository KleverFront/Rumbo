import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchRings } from "../ai";
import { dedupeKey, listPipelineJobIds, markJobSeen, saveToPipeline, setJobDescription, upsertJobs, type Job } from "../db";
import { atsScore, matchJob, type MatchResult } from "../match";
import { loadBaseCv, loadProfile } from "../profile";
import { loadSettings, saveSettings, type AppSettings } from "../settings";
import {
  DATE_FILTERS, SOURCES, WORK_MODES, fetchLinkedInDescription, searchSource,
  type JobInput, type SearchQuery, type WorkMode,
} from "../sources";

interface Scored {
  job: Job;
  match: MatchResult;
  ats: number;
  /** Which AI search ring found it (1 = most specific); undefined for a normal search. */
  ring?: number;
}

type SortBy = "match" | "recent";

const SOURCE_LABEL: Record<string, string> = { remotive: "Remotive", adzuna: "Adzuna", linkedin: "LinkedIn", manual: "Agregada a mano" };

function scoreClass(score: number | null) {
  if (score == null) return "score";
  return `score ${score >= 75 ? "s-hi" : score >= 50 ? "s-md" : "s-lo"}`;
}

function postedLabel(postedAt: string | null): string | null {
  if (!postedAt) return null;
  const days = Math.floor((Date.now() - new Date(postedAt).getTime()) / 86_400_000);
  if (Number.isNaN(days)) return null;
  if (days <= 0) return "hoy";
  if (days === 1) return "hace 1 día";
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  return months === 1 ? "hace 1 mes" : `hace ${months} meses`;
}

const EMPTY_MANUAL = { title: "", company: "", location: "", url: "", description: "" };

/** Stays mounted while hidden (see App), so results survive switching tabs. `active` = tab visible. */
export default function Search({ active, onAdapt }: { active: boolean; onAdapt: (jobId: number) => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [cvText, setCvText] = useState("");
  const [keywords, setKeywords] = useState("");
  const [location, setLocation] = useState("");
  const [workMode, setWorkMode] = useState<WorkMode>("any");
  const [hideSeen, setHideSeen] = useState(true);
  const [quota, setQuota] = useState(30);
  const [rings, setRings] = useState<string[]>([]);
  const [planning, setPlanning] = useState(false);
  const [maxDays, setMaxDays] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("match");
  const [results, setResults] = useState<Scored[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [manual, setManual] = useState<typeof EMPTY_MANUAL | null>(null);
  const [loadingDesc, setLoadingDesc] = useState<number | null>(null);
  const searchRef = useRef<{ id: number; query: SearchQuery; page: number } | null>(null);
  // Per search: dedupe keys already shown, and offers to hide (already seen or in the pipeline).
  const shown = useRef<Set<string>>(new Set());
  const hidden = useRef<{ enabled: boolean; pipeline: Set<number> }>({ enabled: false, pipeline: new Set() });
  const prefilled = useRef(false);

  // Reload profile data whenever the tab becomes visible: the user may have edited the CV meanwhile.
  useEffect(() => {
    if (!active) return;
    Promise.all([loadSettings(), loadProfile(), loadBaseCv()])
      .then(([s, p, cv]) => {
        setSettings(s);
        setSkills(p.skills);
        setCvText([cv?.raw_text ?? "", p.personal.summary, ...p.experience.map((e) => e.description)].join("\n"));
        if (!prefilled.current) {
          prefilled.current = true;
          setKeywords(p.personal.target_role);
          setLocation(p.personal.city);
        }
      })
      .catch((e) => setNotice(`No se pudo cargar su perfil: ${e}`));
  }, [active]);

  const scoreJob = (job: Job): Scored => {
    const text = `${job.title}\n${job.description ?? ""}`;
    return { job, match: matchJob(text, skills, cvText), ats: atsScore(text, cvText) };
  };

  // Rescore when the profile changes.
  useEffect(() => {
    setResults((r) => r.map((x) => scoreJob(x.job)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills, cvText]);

  const enabled = useMemo(() => (settings?.sources ?? "").split(",").filter(Boolean), [settings]);

  const sorted = useMemo(() => {
    const time = (s: Scored) => (s.job.posted_at ? new Date(s.job.posted_at).getTime() : 0);
    return [...results].sort((a, b) =>
      sortBy === "recent"
        ? time(b) - time(a)
        : (b.match.score ?? -1) - (a.match.score ?? -1) || time(b) - time(a),
    );
  }, [results, sortBy]);

  async function toggleSource(id: string) {
    if (!settings) return;
    const next = enabled.includes(id) ? enabled.filter((s) => s !== id) : [...enabled, id];
    const sources = next.join(",");
    setSettings({ ...settings, sources });
    await saveSettings({ sources });
  }

  /**
   * Adds results without duplicating offers already shown (same company + title + city) and, when
   * "ocultar vistas" is on, without offers opened before this search or already in the pipeline.
   */
  function append(jobs: Job[], ring?: number): number {
    const fresh = jobs.filter((j) => {
      const key = dedupeKey(j);
      if (shown.current.has(key)) return false;
      if (hidden.current.enabled && (j.seen_at || hidden.current.pipeline.has(j.id))) return false;
      shown.current.add(key);
      return true;
    });
    setResults((current) => [...current, ...fresh.map((j) => ({ ...scoreJob(j), ring }))]);
    return fresh.length;
  }

  /** Starts a new search: clears results and freezes what counts as "already seen". */
  async function begin(query: SearchQuery) {
    searchRef.current = { id: (searchRef.current?.id ?? 0) + 1, query, page: 0 };
    shown.current = new Set();
    hidden.current = { enabled: hideSeen, pipeline: hideSeen ? await listPipelineJobIds() : new Set() };
    setResults([]);
    setSelectedId(null);
    setHasMore({});
    setLoading(new Set());
    setNotice(null);
    return searchRef.current;
  }

  /** Each source loads on its own, so the fastest ones show up first. */
  function loadPage(sources: string[], page: number) {
    const search = searchRef.current;
    if (!search || !settings) return;
    setLoading((l) => new Set([...l, ...sources]));
    for (const id of sources) {
      searchSource(id, search.query, settings, page)
        .then(async (result) => {
          const jobs = await upsertJobs(result.jobs);
          if (searchRef.current?.id !== search.id) return; // a newer search started
          append(jobs);
          setHasMore((h) => ({ ...h, [id]: result.hasMore }));
        })
        .catch((e) => {
          if (searchRef.current?.id !== search.id) return;
          setHasMore((h) => ({ ...h, [id]: false }));
          setNotice((n) => [n, `${SOURCE_LABEL[id] ?? id}: ${e instanceof Error ? e.message : e}`].filter(Boolean).join(" · "));
        })
        .finally(() => {
          if (searchRef.current?.id === search.id) setLoading((l) => new Set([...l].filter((x) => x !== id)));
        });
    }
  }

  const baseQuery = (): SearchQuery => ({ keywords: keywords.trim(), location: location.trim(), workMode, maxDays });

  async function search() {
    if (!settings || !keywords.trim()) return;
    setRings([]);
    await begin(baseQuery());
    loadPage(enabled, 0);
  }

  /**
   * AI search strategy ("rings", idea taken from Xolva): the AI proposes 4 queries from the most specific
   * to the broadest; they run in order on every enabled portal until `quota` new offers are shown.
   */
  async function smartSearch() {
    if (!settings || !keywords.trim()) return;
    setPlanning(true);
    setNotice(null);
    let plan: string[];
    try {
      const [profile, cv] = await Promise.all([loadProfile(), loadBaseCv()]);
      plan = await searchRings(profile, cv?.raw_text ?? "", keywords.trim(), location.trim());
    } catch (e) {
      setNotice(`No se pudo armar la búsqueda inteligente: ${e instanceof Error ? e.message : e}`);
      return;
    } finally {
      setPlanning(false);
    }
    setRings(plan);
    const run = await begin(baseQuery());
    for (const [i, ring] of plan.entries()) {
      if (shown.current.size >= quota || searchRef.current?.id !== run.id) break;
      const query = { ...run.query, keywords: ring };
      setLoading(new Set(enabled));
      await Promise.allSettled(
        enabled.map((id) =>
          searchSource(id, query, settings, 0)
            .then((page) => upsertJobs(page.jobs))
            .then((jobs) => { if (searchRef.current?.id === run.id) append(jobs, i + 1); })
            .catch((e) => setNotice((n) => [n, `${SOURCE_LABEL[id] ?? id}: ${e instanceof Error ? e.message : e}`].filter(Boolean).join(" · ")))
            .finally(() => setLoading((l) => new Set([...l].filter((x) => x !== id)))),
        ),
      );
    }
  }

  function loadMore() {
    const s = searchRef.current;
    if (!s) return;
    s.page += 1;
    loadPage(Object.keys(hasMore).filter((id) => hasMore[id]), s.page);
  }

  /** LinkedIn search results come without description; fetch it once, store it and rescore. */
  async function ensureDescription(s: Scored): Promise<Scored> {
    if (s.job.source !== "linkedin" || s.job.description) return s;
    setLoadingDesc(s.job.id);
    try {
      const description = await fetchLinkedInDescription(s.job.external_id);
      await setJobDescription(s.job.id, description);
      const updated = scoreJob({ ...s.job, description });
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
    if (!s.job.seen_at) markJobSeen(s.job.id).catch(() => {}); // only feeds "ocultar vistas"; not worth an error
    ensureDescription(s);
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
      posted_at: new Date().toISOString(),
    };
    try {
      const [job] = await upsertJobs([input]);
      shown.current.add(dedupeKey(job));
      setResults((r) => [scoreJob(job), ...r.filter((x) => x.job.id !== job.id)]);
      setSelectedId(job.id);
      setManual(null);
    } catch (e) {
      setNotice(`No se pudo agregar la oferta: ${e}`);
    }
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
      const withDescription = await ensureDescription(s);
      await saveToPipeline(withDescription.job.id, withDescription.match.score);
      onAdapt(withDescription.job.id);
    } catch (e) {
      setNotice(`No se pudo guardar la oferta: ${e}`);
    }
  }

  const selected = results.find((r) => r.job.id === selectedId) ?? null;
  const busy = loading.size > 0;
  const canLoadMore = !busy && Object.values(hasMore).some(Boolean);

  // Auto-open the first result once it arrives, fetching its description if needed.
  useEffect(() => {
    if (selectedId == null && sorted[0]) select(sorted[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted[0]?.job.id]);

  return (
    <section>
      <h2>Buscar ofertas</h2>
      <p className="sub">Un solo buscador para varios portales. Cada oferta se compara con su CV base.</p>

      <form className="search" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input aria-label="Cargo o palabras clave" placeholder="Cargo o palabras clave" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        <input aria-label="Ciudad" placeholder="Ciudad" value={location} disabled={workMode === "remote"} onChange={(e) => setLocation(e.target.value)} />
        <select aria-label="Modalidad" value={workMode} onChange={(e) => setWorkMode(e.target.value as WorkMode)}>
          {WORK_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <select aria-label="Fecha de publicación" value={maxDays ?? ""} onChange={(e) => setMaxDays(e.target.value ? Number(e.target.value) : null)}>
          {DATE_FILTERS.map((f) => <option key={f.label} value={f.days ?? ""}>{f.label}</option>)}
        </select>
        <button type="submit" className="primary" disabled={!keywords.trim() || !enabled.length}>Buscar</button>
      </form>

      <div className="search-options">
        <label className="check"><input type="checkbox" checked={hideSeen} onChange={(e) => setHideSeen(e.target.checked)} /> Ocultar ofertas ya vistas o guardadas</label>
        <span className="smart">
          <button type="button" disabled={planning || busy || !keywords.trim() || !enabled.length} onClick={smartSearch}>
            {planning ? "Preparando búsquedas…" : "Búsqueda inteligente (IA)"}
          </button>
          <label className="check">hasta
            <input type="number" min="5" max="200" step="5" value={quota} aria-label="Cantidad de ofertas"
              onChange={(e) => setQuota(Math.max(5, Number(e.target.value) || 30))} />
            ofertas
          </label>
        </span>
      </div>

      {rings.length > 0 && (
        <div className="rings">
          <span>Búsquedas de la IA, de la más precisa a la más amplia:</span>
          {rings.map((r, i) => <span key={r} className="chip on">{i + 1}. {r}</span>)}
        </div>
      )}

      <div className="chips">
        {SOURCES.map((src) => (
          <button key={src.id} type="button" className={`chip${enabled.includes(src.id) ? " on" : ""}`} aria-pressed={enabled.includes(src.id)} onClick={() => toggleSource(src.id)}>
            {src.label}{loading.has(src.id) ? " · cargando…" : ""}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => setManual(EMPTY_MANUAL)}>+ Pegar oferta</button>
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

      {(results.length > 0 || busy) && (
        <div className="results-bar">
          <span>{results.length} ofertas{busy ? " · cargando…" : ""}</span>
          <label className="check">
            Ordenar por
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
              <option value="match">Compatibilidad</option>
              <option value="recent">Más recientes</option>
            </select>
          </label>
        </div>
      )}

      {results.length === 0 && !busy && searchRef.current && !notice && (
        <p className="sub">No se encontraron ofertas. Pruebe con otras palabras, otra fecha o active más portales.</p>
      )}

      {results.length > 0 && (
        <div className="split">
          <div className="list" role="listbox" aria-label="Resultados">
            {sorted.map((r) => (
              <button key={r.job.id} type="button" role="option" aria-selected={r.job.id === selectedId}
                className={`job${r.job.id === selectedId ? " on" : ""}`} onClick={() => select(r)}>
                <span>
                  <b>{r.job.title}</b>
                  <span className="m">
                    {[r.job.company, r.job.location, SOURCE_LABEL[r.job.source] ?? r.job.source, postedLabel(r.job.posted_at)].filter(Boolean).join(" · ")}
                  </span>
                  {r.ring && <span className="ring">Búsqueda {r.ring}: {rings[r.ring - 1]}</span>}
                </span>
                <span className={scoreClass(r.match.score)}>{r.match.score == null ? "—" : `${r.match.score}%`}</span>
              </button>
            ))}
            {canLoadMore && <button type="button" className="load-more" onClick={loadMore}>Cargar más</button>}
            {busy && <p className="status busy">Cargando ofertas…</p>}
          </div>

          {selected && (
            <div className="card detail">
              <h3>{selected.job.title}</h3>
              <div className="meta">
                {[selected.job.company, selected.job.location, selected.job.salary_text, postedLabel(selected.job.posted_at)].filter(Boolean).join(" · ")}
              </div>
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
