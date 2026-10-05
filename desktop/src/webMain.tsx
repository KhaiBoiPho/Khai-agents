import { createRoot } from "react-dom/client";
import { BrowserShell } from "./BrowserShell";
import "./styles/tokens.css";

const root = document.getElementById("root");
if (!root) throw new Error("Khai-Agents root is missing");
createRoot(root).render(<BrowserShell />);
