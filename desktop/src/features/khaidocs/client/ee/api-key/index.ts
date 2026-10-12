/*
 * KhaiDocs stand-in for an enterprise module. Original code, MIT.
 * The upstream Enterprise Edition is not included: it is licensed separately
 * and may not be used without a subscription. Every enterprise
 * feature reports as unavailable.
 */

export type IApiKey = Record<string, any>;

export async function getApiKeys(..._args: any[]): Promise<any> {
  return { items: [], meta: {} };
}
