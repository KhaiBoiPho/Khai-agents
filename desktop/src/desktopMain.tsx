import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { initI18n } from "./app/i18n";
import { App } from "./App";
import { tauriRuntime, configureNativeDialogs } from "./rpc/tauriRuntime";
import "@fontsource-variable/source-sans-3";
import "@fontsource/inconsolata/400.css";
import "@fontsource/inconsolata/600.css";
import "./styles/tokens.css";

initI18n();
configureNativeDialogs();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Khai-Agents desktop root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <App runtime={tauriRuntime} />
  </StrictMode>,
);
