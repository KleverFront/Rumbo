import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import {
  APPLICATION_STATUSES, FOLLOW_UP_DAYS, listApplications, postponeFollowUp, setApplicationStatus,
  type ApplicationCard, type ApplicationStatus,
} from "../db";

const LABELS: Record<ApplicationStatus, string> = {
  saved: "Guardadas",
  applied: "Postuladas",
  interview: "Entrevista",
  offer: "Oferta",
  discarded: "Descartadas",
};

// SQLite datetime('now') is UTC without a zone marker.
const isDue = (c: ApplicationCard) => c.status === "applied" && !!c.follow_up_at && new Date(c.follow_up_at + "Z") <= new Date();

export default function Pipeline({ onAdapt }: { onAdapt: (jobId: number) => void }) {
  const [cards, setCards] = useState<ApplicationCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    listApplications()
      .then(setCards)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    reload();
  }, []);

  async function move(id: number, status: ApplicationStatus) {
    await setApplicationStatus(id, status);
    await reload();
  }

  return (
    <section>
      <h2>Postulaciones</h2>
      <p className="sub">Al marcar una oferta como «Postulada» se programa un recordatorio de seguimiento en {FOLLOW_UP_DAYS} días.</p>
      {error && <p className="status error">No se pudo leer la base de datos: {error}</p>}
      {loading ? (
        <p className="status busy">Cargando…</p>
      ) : (
        <div className="kanban" style={{ gridTemplateColumns: `repeat(${APPLICATION_STATUSES.length}, minmax(170px, 1fr))` }}>
          {APPLICATION_STATUSES.map((status) => {
            const items = cards.filter((c) => c.status === status);
            return (
              <div className="col" key={status}>
                <h5>{LABELS[status]} · {items.length}</h5>
                {items.map((c) => (
                  <div className="kc" key={c.id}>
                    <b>{c.title}</b>
                    <small>{c.company ?? "—"}{c.match_score != null && ` · ${c.match_score}%`}</small>
                    {isDue(c) && (
                      <small className="due">
                        Seguimiento pendiente ·{" "}
                        <button type="button" className="link" onClick={() => postponeFollowUp(c.id).then(reload)}>posponer</button>
                      </small>
                    )}
                    {c.cv_pdf_path && <small>CV adaptado exportado</small>}
                    <select aria-label="Cambiar estado" value={c.status} onChange={(e) => move(c.id, e.target.value as ApplicationStatus)}>
                      {APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}
                    </select>
                    <div className="card-actions">
                      <button type="button" className="link" onClick={() => onAdapt(c.job_id)}>Adaptar CV</button>
                      {c.url && <button type="button" className="link" onClick={() => openUrl(c.url!)}>Abrir oferta</button>}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
