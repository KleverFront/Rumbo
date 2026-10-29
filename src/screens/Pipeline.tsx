import { useEffect, useState } from "react";
import { ApplicationCard, ApplicationStatus, listApplications } from "../db";

const COLUMNS: { status: ApplicationStatus; label: string }[] = [
  { status: "saved", label: "Guardadas" },
  { status: "applied", label: "Postuladas" },
  { status: "interview", label: "Entrevista" },
  { status: "offer", label: "Oferta" },
  { status: "discarded", label: "Descartadas" },
];

export default function Pipeline() {
  const [cards, setCards] = useState<ApplicationCard[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listApplications().then(setCards).catch((e) => setError(String(e)));
  }, []);

  return (
    <section>
      <h2>Postulaciones</h2>
      <p className="sub">Aquí aparecerán las ofertas que guarde o a las que postule.</p>
      {error && <p className="error">No se pudo leer la base de datos: {error}</p>}
      <div className="kanban">
        {COLUMNS.map((col) => {
          const items = cards.filter((c) => c.status === col.status);
          return (
            <div className="col" key={col.status}>
              <h5>
                {col.label} · {items.length}
              </h5>
              {items.map((c) => (
                <div className="kc" key={c.id}>
                  <b>{c.title}</b>
                  <small>
                    {c.company ?? "—"}
                    {c.match_score != null && ` · ${c.match_score}%`}
                  </small>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
