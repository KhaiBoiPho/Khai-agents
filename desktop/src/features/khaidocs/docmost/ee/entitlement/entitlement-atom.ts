/*
 * KhaiDocs stand-in for a Docmost Enterprise module. Original code, MIT.
 * Docmost's Enterprise Edition is not included: it is licensed separately
 * and may not be used without a Docmost subscription. Every enterprise
 * feature reports as unavailable.
 */

import { atom, type PrimitiveAtom } from "jotai";

export interface Entitlements {
  tier: string;
  features: string[];
}

export const entitlementAtom: PrimitiveAtom<Entitlements | null> = atom<
  Entitlements | null
>(null) as PrimitiveAtom<Entitlements | null>;
