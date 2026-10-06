import { describe, expect, it } from "vitest";

import { describeRunError, isGenericRunError, isProviderErrorText } from "./runErrors";

const GEMINI_503 =
  "Error: [{'error': {'code': 503, 'message': 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.', 'status': 'UNAVAILABLE'}}]";

describe("describeRunError", () => {
  it("unwraps a Gemini 503 repr", () => {
    const view = describeRunError(GEMINI_503);
    expect(view.kind).toBe("overloaded");
    expect(view.code).toBe("503 · UNAVAILABLE");
    expect(view.detail).toMatch(/^This model is currently experiencing high demand/);
  });

  it("tells a spent quota from a rate limit", () => {
    expect(
      describeRunError(`Error: {"error": {"code": 429, "message": "You exceeded your current quota", "status": "RESOURCE_EXHAUSTED"}}`).kind,
    ).toBe("quota");
    expect(describeRunError("Error code: 429 - Too Many Requests").kind).toBe("rate_limited");
  });

  it("recognises auth, missing models and long contexts", () => {
    expect(describeRunError("Error code: 401 - invalid api key").kind).toBe("auth");
    expect(describeRunError(`Error: {"error": {"code": 404, "message": "models/x is not found"}}`).kind).toBe("not_found");
    expect(describeRunError("maximum context length is 128000 tokens").kind).toBe("context");
  });

  it("flags generic stop reasons and echoed provider errors", () => {
    expect(isGenericRunError("agent stopped with reason: error")).toBe(true);
    expect(isProviderErrorText(GEMINI_503)).toBe(true);
    expect(isProviderErrorText("Error handling is explained below.")).toBe(false);
  });
});
