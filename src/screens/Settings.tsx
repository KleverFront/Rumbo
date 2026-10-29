import { useEffect, useState } from "react";
import { CLAUDE_MODELS, DEFAULT_MODELS, SPEND_LIMIT_PROVIDERS, monthSpendUsd } from "../ai";
import { getSecret, loadSettings, saveSettings, setSecret, type AiProvider, type AppSettings, type SecretName } from "../settings";
import { ADZUNA_COUNTRIES } from "../sources";

const PROVIDERS: { id: AiProvider; label: string; secret: SecretName | null; keyUrl?: string }[] = [
  { id: "claude", label: "Claude (Anthropic)", secret: "anthropic", keyUrl: "https://platform.claude.com/settings/keys" },
  { id: "deepseek", label: "DeepSeek", secret: "deepseek", keyUrl: "https://platform.deepseek.com/api_keys" },
  { id: "gemini", label: "Gemini (Google)", secret: "gemini", keyUrl: "https://aistudio.google.com/apikey" },
  { id: "ollama", label: "Ollama (local, sin internet)", secret: null },
];

export default function Settings() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [aiKey, setAiKey] = useState("");
  const [hasAiKey, setHasAiKey] = useState(false);
  const [adzunaId, setAdzunaId] = useState("");
  const [adzunaKey, setAdzunaKey] = useState("");
  const [hasAdzuna, setHasAdzuna] = useState(false);
  const [spent, setSpent] = useState(0);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const provider = PROVIDERS.find((p) => p.id === s?.ai_provider) ?? PROVIDERS[0];

  useEffect(() => {
    Promise.all([loadSettings(), getSecret("adzuna"), monthSpendUsd()])
      .then(([settings, adzuna, total]) => {
        setS(settings);
        setHasAdzuna(!!adzuna);
        setSpent(total);
      })
      .catch((e) => setStatus({ kind: "error", text: String(e) }));
  }, []);

  useEffect(() => {
    setAiKey("");
    if (provider.secret) {
      getSecret(provider.secret).then((v) => setHasAiKey(!!v), (e) => setStatus({ kind: "error", text: `No se pudo leer el Llavero: ${e}` }));
    }
  }, [provider.secret]);

  function changeProvider(id: AiProvider) {
    if (s) setS({ ...s, ai_provider: id, ai_model: DEFAULT_MODELS[id] });
  }

  async function save() {
    if (!s) return;
    try {
      await saveSettings(s);
      // Empty key fields mean "keep the stored one"; the Keychain is only written when something was typed.
      if (provider.secret && aiKey.trim()) {
        await setSecret(provider.secret, aiKey.trim());
        setHasAiKey(true);
        setAiKey("");
      }
      if (adzunaId.trim() && adzunaKey.trim()) {
        await setSecret("adzuna", `${adzunaId.trim()}:${adzunaKey.trim()}`);
        setHasAdzuna(true);
        setAdzunaId("");
        setAdzunaKey("");
      }
      setStatus({ kind: "ok", text: "Ajustes guardados." });
    } catch (e) {
      setStatus({ kind: "error", text: `No se pudo guardar: ${e}` });
    }
  }

  async function forget(name: SecretName) {
    try {
      await setSecret(name, "");
      if (name === "adzuna") setHasAdzuna(false);
      else setHasAiKey(false);
    } catch (e) {
      setStatus({ kind: "error", text: `No se pudo borrar la clave: ${e}` });
    }
  }

  if (!s) return <section><h2>Ajustes</h2>{status && <p className="status error">{status.text}</p>}</section>;

  return (
    <section>
      <h2>Ajustes</h2>
      <p className="sub">Usted elige el proveedor de IA y usa su propia clave. Las claves se guardan en el Llavero de macOS, nunca en un archivo.</p>

      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <fieldset className="block">
          <legend>Inteligencia artificial</legend>
          <div className="grid">
            <label><span>Proveedor</span>
              <select value={s.ai_provider} onChange={(e) => changeProvider(e.target.value as AiProvider)}>
                {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label><span>Modelo</span>
              {s.ai_provider === "claude" ? (
                <select value={s.ai_model} onChange={(e) => setS({ ...s, ai_model: e.target.value })}>
                  {CLAUDE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              ) : (
                <input value={s.ai_model} onChange={(e) => setS({ ...s, ai_model: e.target.value })} />
              )}
            </label>
            {provider.secret && (
              <label className="wide"><span>Clave API {hasAiKey && "(guardada en el Llavero)"}</span>
                <input type="password" autoComplete="off" placeholder={hasAiKey ? "Escriba una nueva para reemplazarla" : "Pegue su clave aquí"}
                  value={aiKey} onChange={(e) => setAiKey(e.target.value)} />
              </label>
            )}
            {provider.secret && (
              <p className="hint wide">
                {provider.keyUrl && <>Obtenga su clave en <code>{provider.keyUrl}</code>. </>}
                {hasAiKey && <button type="button" className="link danger" onClick={() => forget(provider.secret!)}>Borrar clave guardada</button>}
              </p>
            )}
            {s.ai_provider === "ollama" && (
              <label className="wide"><span>Dirección de Ollama</span>
                <input value={s.ollama_url} onChange={(e) => setS({ ...s, ollama_url: e.target.value })} />
              </label>
            )}
            <label><span>Límite de gasto mensual (USD, 0 = sin límite)</span>
              <input type="number" min="0" step="1" value={s.ai_monthly_limit_usd} onChange={(e) => setS({ ...s, ai_monthly_limit_usd: e.target.value })} />
            </label>
            <div className="kpi"><small>Gastado este mes en Claude</small><b>${spent.toFixed(2)}</b></div>
            {!SPEND_LIMIT_PROVIDERS.includes(s.ai_provider) && (
              <p className="hint wide status error">
                El límite de gasto solo cuenta el uso de Claude. El consumo de {provider.label} no se suma: revise su gasto en la consola del proveedor.
              </p>
            )}
          </div>
        </fieldset>

        <fieldset className="block">
          <legend>Portal Adzuna {hasAdzuna && "(clave guardada)"}</legend>
          <p className="hint">Regístrese gratis en <code>developer.adzuna.com</code> para obtener su App ID y App Key. Adzuna no cubre Ecuador: elija el país donde busca.</p>
          <div className="grid">
            <label><span>App ID</span><input autoComplete="off" value={adzunaId} onChange={(e) => setAdzunaId(e.target.value)} /></label>
            <label><span>App Key</span><input type="password" autoComplete="off" value={adzunaKey} onChange={(e) => setAdzunaKey(e.target.value)} /></label>
            <label><span>País</span>
              <select value={s.adzuna_country} onChange={(e) => setS({ ...s, adzuna_country: e.target.value })}>
                {ADZUNA_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </label>
            {hasAdzuna && <p className="hint"><button type="button" className="link danger" onClick={() => forget("adzuna")}>Borrar clave de Adzuna</button></p>}
          </div>
        </fieldset>

        {status && <p className={`status ${status.kind}`} role="status">{status.text}</p>}
        <div className="savebar"><button type="submit" className="primary">Guardar ajustes</button></div>
      </form>
    </section>
  );
}
