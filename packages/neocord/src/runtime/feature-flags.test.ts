import { describe, expect, test } from "bun:test";
import { defineFeature } from "../define.ts";
import { disabledFeatures, type Manifest } from "./manifest.ts";

function manifestWith(enabled: unknown): Manifest {
  return {
    version: 1,
    context: null,
    features: [{ name: "fun", module: { default: { ...defineFeature({}), enabled } } }],
    groups: [],
    routes: [],
  };
}

describe("disabledFeatures", () => {
  test("disables on a boolean false", () => {
    expect(disabledFeatures(manifestWith(false)).has("fun")).toBe(true);
  });

  test("disables on the raw string t3-env returns when validation is skipped", () => {
    for (const raw of ["false", "FALSE", " 0 ", "no", "off", "n", "disabled"]) {
      expect(disabledFeatures(manifestWith(raw)).has("fun")).toBe(true);
    }
  });

  test("keeps the feature for true, truthy strings and unset values", () => {
    for (const value of [true, "true", "1", "yes", undefined]) {
      expect(disabledFeatures(manifestWith(value)).has("fun")).toBe(false);
    }
  });
});
