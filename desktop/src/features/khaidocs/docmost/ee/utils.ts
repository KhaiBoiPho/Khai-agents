/*
 * KhaiDocs stand-in for a Docmost Enterprise module. Original code, MIT.
 * Docmost's Enterprise Edition is not included: it is licensed separately
 * and may not be used without a Docmost subscription. Every enterprise
 * feature reports as unavailable.
 */

export function getHostnameUrl(_hostname: string): string {
  return window.location.origin;
}

export function exchangeTokenRedirectUrl(_hostname: string, _token: string): string {
  return window.location.origin;
}
