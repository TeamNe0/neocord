import { spawn as nodeSpawn, type SpawnOptions, type StdioOptions } from "node:child_process";
import { constants } from "node:os";
import { basename } from "node:path";
import type { Readable } from "node:stream";
import { CliError, errorMessage } from "../errors.ts";

export type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;

export interface ChildHandle {
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "exit" | "close", listener: ExitListener): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  stdout?: Readable | null;
}

export type SpawnFunction = (command: string, args: readonly string[], options: SpawnOptions) => ChildHandle;

export const defaultSpawn: SpawnFunction = (command, args, options) => nodeSpawn(command, [...args], options);

export interface SignalSource {
  on(event: NodeJS.Signals, listener: () => void): unknown;
  off(event: NodeJS.Signals, listener: () => void): unknown;
}

export interface ForwardSignalsOptions {
  source?: SignalSource;
  platform?: NodeJS.Platform;
  consoleGraceMs?: number;
}

export interface RunProcessOptions extends ForwardSignalsOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
  stdio?: StdioOptions;
  spawn?: SpawnFunction;
}

export interface ProcessResult {
  code: number;
  signal: NodeJS.Signals | null;
}

export interface CapturedResult<T> extends ProcessResult {
  result: T | null;
}

const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

export function exitCodeFor(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  return signal === null ? 1 : 128 + (constants.signals[signal] ?? 0);
}

export function forwardSignals(child: ChildHandle, options: ForwardSignalsOptions = {}): () => void {
  const source = options.source ?? process;
  const platform = options.platform ?? process.platform;
  const graceMs = options.consoleGraceMs ?? 5000;
  const timers = new Set<NodeJS.Timeout>();

  const listeners = FORWARDED_SIGNALS.map((signal) => {
    const listener = (): void => {
      if (platform === "win32" && signal === "SIGINT") {
        const timer = setTimeout(() => child.kill(signal), graceMs);
        timer.unref();
        timers.add(timer);
        return;
      }
      child.kill(signal);
    };
    source.on(signal, listener);
    return { signal, listener };
  });

  return () => {
    for (const timer of timers) clearTimeout(timer);
    for (const { signal, listener } of listeners) source.off(signal, listener);
  };
}

function startProcess(
  options: RunProcessOptions,
  stdio: StdioOptions,
): { child: ChildHandle; finished: Promise<ProcessResult> } {
  const spawn = options.spawn ?? defaultSpawn;
  const child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, stdio });
  const finished = new Promise<ProcessResult>((resolve, reject) => {
    const detach = forwardSignals(child, options);
    child.on("error", (error) => {
      detach();
      reject(new CliError(`Could not start ${basename(options.command)}: ${errorMessage(error)}`));
    });
    child.on("close", (code, signal) => {
      detach();
      resolve({ code: exitCodeFor(code, signal), signal });
    });
  });
  return { child, finished };
}

export function runProcess(options: RunProcessOptions): Promise<ProcessResult> {
  return startProcess(options, options.stdio ?? "inherit").finished;
}

function parseTaggedLine<T>(line: string, tag: string): T | null {
  if (!line.startsWith('{"neocord":')) return null;
  try {
    const parsed = JSON.parse(line) as { neocord?: unknown };
    return parsed.neocord === tag ? (parsed as T) : null;
  } catch {
    return null;
  }
}

export async function runTaggedProcess<T>(
  options: RunProcessOptions,
  tag: string,
  passthrough: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Promise<CapturedResult<T>> {
  const { child, finished } = startProcess(options, ["inherit", "pipe", "inherit"]);
  let result: T | null = null;
  let pending = "";

  const handleLine = (rawLine: string): void => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const parsed = parseTaggedLine<T>(line, tag);
    if (parsed !== null) result = parsed;
    else passthrough(line);
  };

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  });

  const processResult = await finished;
  if (pending.length > 0) handleLine(pending);
  return { ...processResult, result };
}
