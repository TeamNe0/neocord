import type { Logger } from "neocord";

export interface RecordingLogger extends Logger {
  readonly lines: readonly string[];
}

export function createRecordingLogger(): RecordingLogger {
  const lines: string[] = [];
  const write =
    (level: string) =>
    (message: string): void => {
      lines.push(`${level}: ${message}`);
    };
  const logger: RecordingLogger = {
    level: "debug",
    lines,
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    child: () => logger,
  };
  return logger;
}
