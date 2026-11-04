export type DurationUnit = "ms" | "s" | "m" | "h" | "d";

type DurationPart = `${number}${DurationUnit}`;

export type DurationString = DurationPart | `${DurationPart}${DurationPart}` | `${DurationPart}${DurationPart}${DurationPart}`;

export type DurationInput = DurationString | number;

const UNIT_MS: Record<DurationUnit, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const WHOLE = /^(?:\d+(?:\.\d+)?(?:ms|s|m|h|d))+$/;
const PART = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/g;

function invalid(input: unknown): Error {
  return new Error(
    `Invalid duration ${JSON.stringify(input) ?? String(input)}. Use a number of milliseconds or a string such as "500ms", "5s", "5m" or "1h30m".`,
  );
}

export function parseDuration(input: DurationInput): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) throw invalid(input);
    return input;
  }
  if (typeof input !== "string") throw invalid(input);
  const text = input.trim();
  if (!WHOLE.test(text)) throw invalid(input);

  let total = 0;
  for (const match of text.matchAll(PART)) {
    total += Number(match[1]) * UNIT_MS[match[2] as DurationUnit];
  }
  return total;
}
