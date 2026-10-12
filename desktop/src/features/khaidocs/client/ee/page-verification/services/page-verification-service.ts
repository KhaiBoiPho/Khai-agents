/*
 * KhaiDocs stand-in for an enterprise module. Original code, MIT.
 * The upstream Enterprise Edition is not included: it is licensed separately
 * and may not be used without a subscription. Every enterprise
 * feature reports as unavailable.
 */

export async function getVerificationList(..._args: any[]): Promise<any> {
  return { items: [], meta: {} };
}
