import { describe, expect, expectTypeOf, test } from "bun:test";
import { parseDuration, type DurationInput, type DurationString } from "./duration.ts";

describe("parseDuration", () => {
  test("parses single units", () => {
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("5s")).toBe(5000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("1d")).toBe(86_400_000);
    expect(parseDuration("1.5s")).toBe(1500);
  });

  test("parses compound strings", () => {
    expect(parseDuration("1h30m")).toBe(5_400_000);
    expect(parseDuration("1d2h3m")).toBe(93_780_000);
    expect(parseDuration("1m500ms")).toBe(60_500);
  });

  test("passes numbers through", () => {
    expect(parseDuration(1234)).toBe(1234);
    expect(parseDuration(0)).toBe(0);
  });

  test("rejects anything else with a clear message", () => {
    for (const input of ["", "5", "m", "5x", "5 m", "1h 30m", "-5s", "abc"]) {
      expect(() => parseDuration(input as DurationString)).toThrow("Invalid duration");
    }
    expect(() => parseDuration(-1)).toThrow("Invalid duration -1");
    expect(() => parseDuration(Number.NaN)).toThrow("Invalid duration");
    expect(() => parseDuration(null as unknown as DurationInput)).toThrow("Invalid duration null");
  });

  test("template literal type", () => {
    expectTypeOf<"5m">().toExtend<DurationString>();
    expectTypeOf<"1h30m">().toExtend<DurationString>();
    expectTypeOf<"500ms">().toExtend<DurationString>();
    expectTypeOf<"1d2h3m">().toExtend<DurationString>();
    expectTypeOf<number>().toExtend<DurationInput>();
    expectTypeOf<"soon">().not.toExtend<DurationString>();
    expectTypeOf<"5">().not.toExtend<DurationString>();
  });
});
