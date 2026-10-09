import { createRoot } from "react-dom/client";
import { BrowserShell } from "./BrowserShell";
import { AccountGate } from "./features/account/AccountGate";
import "@fontsource-variable/source-sans-3";
import "@fontsource/inconsolata/400.css";
import "@fontsource/inconsolata/600.css";
import "./styles/tokens.css";

const root = document.getElementById("root");
if (!root) throw new Error("Khai-Agents root is missing");
createRoot(root).render(
  <AccountGate>
    <BrowserShell />
  </AccountGate>,
);
