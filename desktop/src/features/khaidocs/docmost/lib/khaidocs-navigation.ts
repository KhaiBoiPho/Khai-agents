/**
 * Docmost navigates with window.location in a few places (hard redirects to
 * the login page, pathname checks in the API client). Inside the desktop app
 * that would leave KhaiDocs and reload the whole shell, so those call sites
 * go through this bridge to the KhaiDocs router instead.
 */

type Navigate = (to: string, options?: { replace?: boolean }) => void;

let navigateImpl: Navigate | null = null;
let currentLocation = { pathname: "/home", search: "", hash: "" };

export function bindKhaiDocsRouter(navigate: Navigate) {
  navigateImpl = navigate;
}

export function trackKhaiDocsLocation(location: {
  pathname: string;
  search: string;
  hash: string;
}) {
  currentLocation = location;
}

/** Stands in for `window.location.href = to` / `.replace(to)`. */
export function hardNavigate(to: string, options?: { replace?: boolean }) {
  if (/^https?:\/\//.test(to)) {
    window.open(to, "_blank", "noopener");
    return;
  }
  navigateImpl?.(to, options);
}

/** Stands in for `window.location.pathname` and friends. */
export function khaiDocsLocation() {
  return currentLocation;
}
