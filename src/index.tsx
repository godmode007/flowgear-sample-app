import { createRoot } from "react-dom/client";
import "./index.scss";
import App from "./components/App.tsx";
import { Flowgear } from "flowgear-webapp";

const rootEl = document.getElementById("root")!;
const standaloneApiUrl = (import.meta as { env?: Record<string, string> }).env?.VITE_STANDALONE_API_URL ?? "";

function renderApp() {
  createRoot(rootEl).render(<App />);
}

/** When embedded in Flowgear Console, wait for SDK init (or this timeout) so published app handshake can complete. */
const INIT_TIMEOUT_MS = 15000;

if (standaloneApiUrl.length > 0) {
  renderApp();
} else {
  Promise.race([
    Flowgear.Sdk.init().catch(() => {}),
    new Promise<void>((r) => setTimeout(r, INIT_TIMEOUT_MS)),
  ])
    .then(renderApp)
    .catch(renderApp);
}
