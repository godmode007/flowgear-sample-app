import { createRoot } from "react-dom/client";
import "./index.scss";
import App from "./components/App.tsx";
import { Flowgear } from "flowgear-webapp";

const rootEl = document.getElementById("root")!;
const standaloneApiUrl = (import.meta as { env?: Record<string, string> }).env?.VITE_STANDALONE_API_URL ?? "";

function renderApp() {
  createRoot(rootEl).render(<App />);
}

if (standaloneApiUrl.length > 0) {
  renderApp();
} else {
  // Match Support Dashboard: init handshake runs in parallel; do not block first paint.
  void Flowgear.Sdk.init().catch(() => {});
  renderApp();
}
