import { useState, type ReactNode } from "react";
import Pipeline from "./screens/Pipeline";
import "./App.css";

type ScreenId = "search" | "cv" | "pipeline" | "profile" | "settings";

function Placeholder({ title, sub }: { title: string; sub: string }) {
  return (
    <section>
      <h2>{title}</h2>
      <p className="sub">{sub}</p>
      <div className="empty">En construcción.</div>
    </section>
  );
}

const SCREENS: { id: ScreenId; icon: string; label: string; render: () => ReactNode }[] = [
  {
    id: "search",
    icon: "🔎",
    label: "Buscar ofertas",
    render: () => (
      <Placeholder title="Buscar ofertas" sub="Un solo buscador para varios portales. Cada oferta se compara con su CV base." />
    ),
  },
  {
    id: "cv",
    icon: "📄",
    label: "Adaptar CV",
    render: () => <Placeholder title="Adaptar CV" sub="Elija una oferta para generar un CV adaptado a ella." />,
  },
  { id: "pipeline", icon: "📋", label: "Postulaciones", render: () => <Pipeline /> },
  {
    id: "profile",
    icon: "👤",
    label: "Mi perfil y CV base",
    render: () => <Placeholder title="Mi perfil y CV base" sub="Su CV se guarda solo en esta Mac." />,
  },
  {
    id: "settings",
    icon: "⚙️",
    label: "Ajustes",
    render: () => <Placeholder title="Ajustes" sub="Usted elige el proveedor de IA y usa su propia clave." />,
  },
];

export default function App() {
  const [screen, setScreen] = useState<ScreenId>("search");
  const current = SCREENS.find((s) => s.id === screen)!;

  return (
    <div className="app">
      <aside className="side">
        {SCREENS.map((s) => (
          <button key={s.id} className={`nav${s.id === screen ? " on" : ""}`} onClick={() => setScreen(s.id)}>
            <span aria-hidden="true">{s.icon}</span> {s.label}
          </button>
        ))}
      </aside>
      <main>{current.render()}</main>
    </div>
  );
}
