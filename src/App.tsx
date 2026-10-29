import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useEffect, useState } from "react";
import { dueFollowUps } from "./db";
import AdaptCv from "./screens/AdaptCv";
import Pipeline from "./screens/Pipeline";
import ProfileScreen from "./screens/Profile";
import Search from "./screens/Search";
import Settings from "./screens/Settings";
import { loadSettings, saveSettings } from "./settings";
import "./App.css";

type ScreenId = "search" | "cv" | "pipeline" | "profile" | "settings";

const NAV: { id: ScreenId; label: string }[] = [
  { id: "search", label: "Buscar ofertas" },
  { id: "cv", label: "Adaptar CV" },
  { id: "pipeline", label: "Postulaciones" },
  { id: "profile", label: "Mi perfil y CV base" },
  { id: "settings", label: "Ajustes" },
];

/** One macOS notification per day listing the applications that need a follow-up. */
async function notifyFollowUps() {
  const today = new Date().toISOString().slice(0, 10);
  const settings = await loadSettings();
  if (settings.last_reminder_date === today) return;
  const due = await dueFollowUps();
  if (!due.length) return;
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (!granted) return;
  sendNotification({
    title: "Rumbo: seguimiento pendiente",
    body: due.length === 1
      ? `Haga seguimiento a «${due[0].title}».`
      : `Tiene ${due.length} postulaciones sin respuesta hace una semana.`,
  });
  await saveSettings({ last_reminder_date: today });
}

export default function App() {
  const [screen, setScreen] = useState<ScreenId>("search");
  const [cvJobId, setCvJobId] = useState<number | null>(null);

  useEffect(() => {
    notifyFollowUps().catch((e) => console.warn("follow-up reminder failed", e));
  }, []);

  const adapt = (jobId: number) => {
    setCvJobId(jobId);
    setScreen("cv");
  };

  return (
    <div className="app">
      <aside className="side">
        {NAV.map((s) => (
          <button key={s.id} className={`nav${s.id === screen ? " on" : ""}`} onClick={() => setScreen(s.id)}>
            {s.label}
          </button>
        ))}
      </aside>
      <main>
        {/* Search stays mounted so its results survive switching tabs; the others reload on open. */}
        <div hidden={screen !== "search"}>
          <Search active={screen === "search"} onAdapt={adapt} />
        </div>
        {screen === "cv" && <AdaptCv jobId={cvJobId} onPickJob={setCvJobId} />}
        {screen === "pipeline" && <Pipeline onAdapt={adapt} />}
        {screen === "profile" && <ProfileScreen />}
        {screen === "settings" && <Settings />}
      </main>
    </div>
  );
}
