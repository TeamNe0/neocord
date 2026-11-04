export interface CliErrorOptions {
  hint?: string;
  details?: readonly string[];
  exitCode?: number;
}

export class CliError extends Error {
  override readonly name: string = "CliError";
  readonly hint: string | undefined;
  readonly details: readonly string[];
  readonly exitCode: number;

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message);
    this.hint = options.hint;
    this.details = options.details ?? [];
    this.exitCode = options.exitCode ?? 1;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
