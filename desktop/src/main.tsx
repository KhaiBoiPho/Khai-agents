const entry = import.meta.env.MODE === "web"
  ? import("./webMain")
  : import("./desktopMain");
void entry.catch((error) => {
  const root = document.getElementById("root");
  if (root) root.textContent = `Khai-Agents could not load: ${String(error)}`;
});
