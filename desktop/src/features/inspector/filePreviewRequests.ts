/**
 * "Open this file in the Files tab" requests from outside the Inspector
 * (e.g. a document card in the chat). The Files panel may not be mounted when
 * the request is made, so the latest path waits here until it subscribes.
 */

type Listener = (path: string) => void;

let pending: string | null = null;
const listeners = new Set<Listener>();

export function requestFilePreview(path: string): void {
  if (listeners.size === 0) {
    pending = path;
    return;
  }
  pending = null;
  listeners.forEach((listener) => listener(path));
}

/** Receive requests; a request made before subscribing is delivered at once. */
export function subscribeFilePreview(listener: Listener): () => void {
  listeners.add(listener);
  if (pending !== null) {
    const path = pending;
    pending = null;
    listener(path);
  }
  return () => {
    listeners.delete(listener);
  };
}
