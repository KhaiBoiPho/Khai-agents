/**
 * "Open this file in the Files tab" requests from outside the Inspector
 * (e.g. a document card or a citation in the chat). The Files panel may not
 * be mounted when the request is made, so the latest request waits here
 * until it subscribes.
 */

/** 1-based, inclusive lines to reveal and highlight. */
export interface LineRange {
  start: number;
  end: number;
}

type Listener = (path: string, lines?: LineRange) => void;

let pending: { path: string; lines?: LineRange } | null = null;
const listeners = new Set<Listener>();

export function requestFilePreview(path: string, lines?: LineRange): void {
  if (listeners.size === 0) {
    pending = { path, lines };
    return;
  }
  pending = null;
  listeners.forEach((listener) => listener(path, lines));
}

/** Receive requests; a request made before subscribing is delivered at once. */
export function subscribeFilePreview(listener: Listener): () => void {
  listeners.add(listener);
  if (pending !== null) {
    const { path, lines } = pending;
    pending = null;
    listener(path, lines);
  }
  return () => {
    listeners.delete(listener);
  };
}
