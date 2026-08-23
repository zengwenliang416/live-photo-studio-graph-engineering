import assert from "node:assert/strict";
import test from "node:test";
import {
  MockImageGenerationProvider,
  ProviderFailureError,
  assertProviderBudget,
  type ImageGenerationProvider,
} from "./provider.js";

test("mock provider is free and stays within an ordinary CI budget", () => {
  const provider = new MockImageGenerationProvider();
  assertProviderBudget(provider, 0);
  assert.equal(provider.estimatedCostMicros, 0);
});

test("budget rejection is stable and non-retryable", () => {
  const provider: ImageGenerationProvider = {
    name: "paid-test-provider",
    estimatedCostMicros: 10,
    async generate() {
      return [];
    },
  };
  assert.throws(
    () => assertProviderBudget(provider, 9),
    (error: unknown) =>
      error instanceof ProviderFailureError &&
      error.code === "MODEL_BUDGET_EXCEEDED" &&
      error.retryable === false,
  );
});
