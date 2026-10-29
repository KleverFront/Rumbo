import { useEffect, useRef, useState } from "react";
import type { TailoredCv } from "../ai";
import { ACCENTS, TEMPLATES, type CvDesign, type HeadingsLang, type TemplateId } from "../cv/design";
import { renderCvPdf } from "../cv/pdf";
import { ACCEPTED_PHOTO_TYPES } from "../cv/photo";
import { renderPdfPages } from "../cv/preview";
import type { PersonalData } from "../profile";

type Filter = "all" | "ats" | "mail";

interface Props {
  cv: TailoredCv;
  personal: PersonalData;
  design: CvDesign;
  onChange: (design: CvDesign) => void;
  photo: string | null;
  onUploadPhoto: (file: File) => void;
  onExport: () => void;
  busy: boolean;
}

const PREVIEW_WIDTH = 560;
const THUMB_WIDTH = 150;

export default function DesignTab({ cv, personal, design, onChange, photo, onUploadPhoto, onExport, busy }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [pages, setPages] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Partial<Record<TemplateId, string>>>({});
  const previewRef = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<CvDesign>) => onChange({ ...design, ...patch });
  const showPhoto = design.photo && !!photo;

  // Live preview of the real PDF; debounced so color clicks do not queue many renders.
  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const canvases = await renderPdfPages(await renderCvPdf(cv, personal, design, photo), PREVIEW_WIDTH);
        if (cancelled || !previewRef.current) return;
        previewRef.current.replaceChildren(...canvases);
        setPages(canvases.length);
        setPreviewError(null);
      } catch (e) {
        if (!cancelled) setPreviewError(e instanceof Error ? e.message : String(e));
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [cv, personal, design, photo]);

  // Thumbnails of every template with the current color/photo/paper, rendered one by one in the background.
  useEffect(() => {
    let cancelled = false;
    setThumbs({});
    (async () => {
      for (const t of TEMPLATES) {
        if (cancelled) return;
        try {
          const blob = await renderCvPdf(cv, personal, { ...design, template: t.id }, photo);
          const [canvas] = await renderPdfPages(blob, THUMB_WIDTH, 1);
          if (!cancelled && canvas) setThumbs((m) => ({ ...m, [t.id]: canvas.toDataURL("image/png") }));
        } catch {
          // A failed thumbnail only leaves its card without an image.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Template choice does not change thumbnails; everything else does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cv, personal, design.accent, design.photo, design.paper, design.headingsLang, photo]);

  const current = TEMPLATES.find((t) => t.id === design.template) ?? TEMPLATES[0];
  const visible = TEMPLATES.filter((t) => filter === "all" || (filter === "ats" ? t.ats : !t.ats));

  return (
    <div className="design">
      <div className="design-panel">
        <h4>Plantilla</h4>
        <div className="filters" role="group" aria-label="Filtrar plantillas">
          {([["all", `Todas (${TEMPLATES.length})`], ["ats", "Compatibles con ATS"], ["mail", "Para correo"]] as const).map(([id, label]) => (
            <button key={id} type="button" className={`chip${filter === id ? " on" : ""}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="tpls">
          {visible.map((t) => (
            <button key={t.id} type="button" className={`tpl${t.id === design.template ? " on" : ""}`} aria-pressed={t.id === design.template}
              onClick={() => set({ template: t.id })}>
              <span className="mini">{thumbs[t.id] ? <img src={thumbs[t.id]} alt="" /> : <span className="mini-loading">Generando…</span>}</span>
              <b>{t.name}</b>
              <small>{t.description}</small>
              <span className={`badge ${t.ats ? "b-ok" : "b-warn"}`}>{t.ats ? "Compatible con ATS" : "Mejor para correo"}</span>
            </button>
          ))}
        </div>

        <h4>Color de acento</h4>
        <div className="swatches">
          {ACCENTS.map((a) => (
            <button key={a.hex} type="button" className={`sw${design.accent === a.hex ? " on" : ""}`} style={{ background: a.hex }}
              aria-label={a.name} aria-pressed={design.accent === a.hex} title={a.name} onClick={() => set({ accent: a.hex })} />
          ))}
        </div>

        <h4>Opciones</h4>
        <div className="row">
          <span>Foto<small>Muchas empresas en Ecuador la piden; los sistemas ATS la ignoran.</small></span>
          <button type="button" role="switch" aria-checked={design.photo} aria-label="Mostrar foto"
            className={`switch${design.photo ? " on" : ""}`} onClick={() => set({ photo: !design.photo })} />
        </div>
        {design.photo && (
          <div className="photo-row">
            {photo ? <img className="photo-thumb" src={photo} alt="Su foto" /> : <span className="hint">Aún no ha subido una foto.</span>}
            <label className="button-like">
              {photo ? "Cambiar foto" : "Subir foto"}
              <input type="file" accept={ACCEPTED_PHOTO_TYPES} hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadPhoto(f); e.target.value = ""; }} />
            </label>
          </div>
        )}
        <div className="row">
          <span>Papel</span>
          <span className="seg" role="group" aria-label="Papel">
            {(["A4", "LETTER"] as const).map((p) => (
              <button key={p} type="button" className={design.paper === p ? "on" : ""} aria-pressed={design.paper === p} onClick={() => set({ paper: p })}>
                {p === "A4" ? "A4" : "Carta"}
              </button>
            ))}
          </span>
        </div>
        <div className="row">
          <span>Idioma de los títulos</span>
          <select value={design.headingsLang} onChange={(e) => set({ headingsLang: e.target.value as HeadingsLang })}>
            <option value="auto">Según el CV</option>
            <option value="es">Español</option>
            <option value="en">Inglés</option>
          </select>
        </div>

        <p className="hint">
          {current.ats
            ? "Compatible con ATS: una sola columna y texto real, segura para portales de empleo."
            : "Pensada para enviar por correo a una persona. En portales con ATS use una plantilla compatible."}
          {" "}Esta oferta recordará el diseño elegido.
        </p>
        <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={onExport}>Exportar PDF</button>
        </div>
      </div>

      <div>
        <div className="previewbar">
          <span>Vista previa del PDF real · {current.name}{pages ? ` · ${pages} ${pages === 1 ? "página" : "páginas"}` : ""}</span>
          {design.photo && !photo && <span>La foto aparecerá cuando la suba.</span>}
          {showPhoto && <span>Con foto</span>}
        </div>
        {previewError && <p className="status error">No se pudo generar la vista previa: {previewError}</p>}
        <div className="stage" ref={previewRef} aria-label="Vista previa del CV" />
      </div>
    </div>
  );
}
