import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { saveToPipeline, upsertJobs, type Job } from "../db";
import { loadProfile } from "../profile";
import type { JobInput } from "../sources";
import "./Browser.css";

const PORTALS = [
  { id: "indeed", label: "Indeed" },
  { id: "computrabajo", label: "Computrabajo" },
  { id: "multitrabajos", label: "Multitrabajos" },
];

/** Payload emitted by src-tauri/src/browser.rs after validating the page data. */
interface ImportedOffer {
  portal: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string | null;
  description: string;
  posted_at: string | null;
}

export default function Browser({ onAdapt }: { onAdapt: (jobId: number) => void }) {
  const [keywords, setKeywords] = useState("");
  const [imported, setImported] = useState<Job[]>([]);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    loadProfile()
      .then((p) => setKeywords((k) => k || p.personal.target_role))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unlisten = listen<ImportedOffer>("browser-import", async ({ payload: o }) => {
      const input: JobInput = {
        source: o.portal,
        // Without a canonical URL the title keeps re-imports of the same offer idempotent.
        external_id: o.url ?? `${o.title}|${o.company ?? ""}`,
        url: o.url,
        title: o.title,
        company: o.company,
        location: o.location,
        remote: /remot/i.test(`${o.location ?? ""} ${o.title}`),
        salary_text: null,
        description: o.description,
        posted_at: o.posted_at,
      };
      try {
        const [job] = await upsertJobs([input]);
        await saveToPipeline(job.id, null);
        setImported((list) => [job, ...list.filter((j) => j.id !== job.id)]);
        setStatus({ text: `Oferta importada y guardada en Postulaciones: ${job.title}` });
      } catch (e) {
        setStatus({ text: `No se pudo guardar la oferta: ${e}`, error: true });
      }
    });
    return () => {
      unlisten.then((stop) => stop());
    };
  }, []);

  async function open(portal: string) {
    try {
      await invoke("browser_open", { portal, query: keywords.trim() || null });
      setStatus(null);
    } catch (e) {
      setStatus({ text: `No se pudo abrir el portal: ${e}`, error: true });
    }
  }

  return (
    <section className="browser">
      <h2>Navegador integrado</h2>
      <p className="sub">
        Navegue en Indeed, Computrabajo o Multitrabajos como lo haría normalmente. Al abrir una oferta, pulse
        «Importar esta oferta a Rumbo» para guardarla aquí.
      </p>
      <div className="browser-bar">
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="Palabras clave, por ejemplo: analista de datos"
          aria-label="Palabras clave"
        />
        {PORTALS.map((p) => (
          <button key={p.id} type="button" className="primary" onClick={() => open(p.id)}>
            Abrir {p.label}
          </button>
        ))}
      </div>
      {status && <p className={status.error ? "status error" : "status"}>{status.text}</p>}
      <h3>Ofertas importadas en esta sesión</h3>
      {imported.length === 0 ? (
        <p className="empty">Aún no ha importado ofertas.</p>
      ) : (
        <div className="list">
          {imported.map((j) => (
            <div className="browser-job" key={j.id}>
              <div>
                <b>{j.title}</b>
                <span className="m">{[j.company, j.location, j.source].filter(Boolean).join(" · ")}</span>
              </div>
              <button type="button" onClick={() => onAdapt(j.id)}>Adaptar CV</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
