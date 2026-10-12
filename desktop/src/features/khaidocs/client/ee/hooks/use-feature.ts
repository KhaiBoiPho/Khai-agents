/*
 * KhaiDocs stand-in for an enterprise module. Original code, MIT.
 * The upstream Enterprise Edition is not included: it is licensed separately
 * and may not be used without a subscription. The features below are
 * implemented natively by KhaiDocs' own server (core/khaidocs), so they are
 * reported as available; every other enterprise feature stays unavailable.
 */

import { Feature } from "@/ee/features";

const NATIVE_FEATURES: ReadonlySet<string> = new Set([
  Feature.COMMENT_RESOLUTION, // comments/resolve
  Feature.DOCX_EXPORT, // docx-export
  Feature.DOCX_IMPORT, // pages/import with .docx
]);

export const useHasFeature = (feature: string): boolean =>
  NATIVE_FEATURES.has(feature);
