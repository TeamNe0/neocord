import { inspect } from "node:util";
import { workerData } from "node:worker_threads";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export type LogMethod = "debug" | "info" | "warn" | "error";

export interface Logger {
  readonly level: LogLevel;
  debug(message: string, ...details: unknown[]): void;
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
  child(scope: string): Logger;
}

export type LogSink = (level: LogMethod, line: string) => void;

export interface LoggerOptions {
  level?: LogLevel;
  shard?: number | readonly number[] | string | null;
  scope?: string;
  secrets?: readonly (string | undefined | null)[];
  sink?: LogSink;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 50 };
const TOKEN_PATTERN = /[\w-]{24,}\.[\w-]{4,}\.[\w-]{20,}/g;
const REDACTED = "[redacted]";

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && Object.hasOwn(ORDER, value);
}

export function resolveLogLevel(configured?: LogLevel): LogLevel {
  const fromEnv = process.env.NEOCORD_LOG_LEVEL?.trim().toLowerCase();
  if (isLogLevel(fromEnv)) return fromEnv;
  return configured ?? "info";
}

export function currentShardLabel(): string | null {
  const data = (workerData ?? process.env) as { SHARDS?: unknown; SHARDING_MANAGER?: unknown } | null;
  if (data?.SHARDS === undefined || data.SHARDS === null || !data.SHARDING_MANAGER) return null;
  return String(data.SHARDS);
}

function defaultSink(level: LogMethod, line: string): void {
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

function formatDetail(detail: unknown): string {
  if (detail instanceof Error) return detail.stack ?? `${detail.name}: ${detail.message}`;
  if (typeof detail === "string") return detail;
  return inspect(detail, { depth: 4, breakLength: Number.POSITIVE_INFINITY });
}

function shardLabel(shard: LoggerOptions["shard"]): string | null {
  if (shard === undefined || shard === null) return null;
  return typeof shard === "object" ? shard.join(",") : String(shard);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? resolveLogLevel();
  const sink = options.sink ?? defaultSink;
  const shard = shardLabel(options.shard);
  const secrets = (options.secrets ?? []).filter((secret): secret is string => typeof secret === "string" && secret !== "");

  const redact = (text: string): string => {
    let result = text;
    const candidates = process.env.DISCORD_TOKEN ? [...secrets, process.env.DISCORD_TOKEN] : secrets;
    for (const secret of candidates) {
      if (secret !== "") result = result.replaceAll(secret, REDACTED);
    }
    return result.replace(TOKEN_PATTERN, REDACTED);
  };

  const prefix = [shard === null ? null : `shard ${shard}`, options.scope ?? null].filter(Boolean).join(" ");

  const write = (method: LogMethod, message: string, details: readonly unknown[]): void => {
    if (ORDER[method] < ORDER[level]) return;
    const body = [message, ...details.map(formatDetail)].join(" ");
    const time = new Date().toISOString();
    const tag = method.toUpperCase().padEnd(5);
    sink(method, redact(`${time} ${tag}${prefix === "" ? "" : ` [${prefix}]`} ${body}`));
  };

  return {
    level,
    debug: (message, ...details) => write("debug", message, details),
    info: (message, ...details) => write("info", message, details),
    warn: (message, ...details) => write("warn", message, details),
    error: (message, ...details) => write("error", message, details),
    child: (scope) =>
      createLogger({
        ...options,
        level,
        scope: options.scope === undefined ? scope : `${options.scope} ${scope}`,
      }),
  };
}
