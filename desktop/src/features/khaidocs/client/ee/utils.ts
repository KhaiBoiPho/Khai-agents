/*
 * KhaiDocs stand-in for an enterprise module. Original code, MIT.
 * The upstream Enterprise Edition is not included: it is licensed separately
 * and may not be used without a subscription. Every enterprise
 * feature reports as unavailable.
 */

export function getHostnameUrl(_hostname: string): string {
  return window.location.origin;
}

export function exchangeTokenRedirectUrl(_hostname: string, _token: string): string {
  return window.location.origin;
}
