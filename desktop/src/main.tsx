import "./polyfills";

// The web client is the only frontend: the browser talks to the App Server.
void import("./webMain").catch((error) => {
  const root = document.getElementById("root");
  if (root) root.textContent = `Khai-Agents could not load: ${String(error)}`;
});
