import { styleText } from "node:util";
import { CliError, errorMessage } from "./errors.ts";

export interface OutputStream {
  write(text: string): unknown;
  isTTY?: boolean;
}

export interface UiOptions {
  stdout?: OutputStream;
  stderr?: OutputStream;
  env?: Record<string, string | undefined>;
}

export type TextStyle = "red" | "green" | "yellow" | "cyan" | "dim" | "bold";

export interface TreeNode {
  label: string;
  children?: readonly TreeNode[];
}

function colorEnabled(stream: OutputStream, env: Record<string, string | undefined>): boolean {
  if (env.NO_COLOR || env.NODE_DISABLE_COLORS) return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== "0" && env.FORCE_COLOR !== "false";
  return stream.isTTY === true;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTable(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const formatRow = (row: readonly string[]): string =>
    row
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd();
  return [formatRow(headers), formatRow(widths.map((width) => "-".repeat(width))), ...rows.map(formatRow)];
}

export function formatTree(nodes: readonly TreeNode[], prefix = ""): string[] {
  const lines: string[] = [];
  for (const [index, node] of nodes.entries()) {
    const last = index === nodes.length - 1;
    lines.push(`${prefix}${last ? "└─ " : "├─ "}${node.label}`);
    if (node.children?.length) {
      lines.push(...formatTree(node.children, `${prefix}${last ? "   " : "│  "}`));
    }
  }
  return lines;
}

export class Ui {
  readonly stdout: OutputStream;
  readonly stderr: OutputStream;
  readonly #outColor: boolean;
  readonly #errColor: boolean;

  constructor(options: UiOptions = {}) {
    const env = options.env ?? process.env;
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.#outColor = colorEnabled(this.stdout, env);
    this.#errColor = colorEnabled(this.stderr, env);
  }

  #paint(style: TextStyle, text: string, enabled: boolean): string {
    return enabled ? styleText(style, text, { validateStream: false }) : text;
  }

  style(style: TextStyle, text: string): string {
    return this.#paint(style, text, this.#outColor);
  }

  print(line = ""): void {
    this.stdout.write(`${line}\n`);
  }

  info(message: string): void {
    this.print(`${this.style("cyan", "›")} ${message}`);
  }

  success(message: string): void {
    this.print(`${this.style("green", "✓")} ${message}`);
  }

  warn(message: string): void {
    this.stderr.write(`${this.#paint("yellow", "!", this.#errColor)} ${message}\n`);
  }

  error(message: string): void {
    this.stderr.write(`${this.#paint("red", "✗", this.#errColor)} ${message}\n`);
  }

  detail(message: string): void {
    this.stderr.write(`  ${message}\n`);
  }

  table(headers: readonly string[], rows: readonly (readonly string[])[]): void {
    const [head, rule, ...body] = formatTable(headers, rows);
    this.print(this.style("bold", head ?? ""));
    this.print(this.style("dim", rule ?? ""));
    for (const row of body) this.print(row);
  }

  tree(nodes: readonly TreeNode[]): void {
    for (const line of formatTree(nodes)) this.print(line);
  }

  reportError(error: unknown): void {
    this.error(errorMessage(error));
    if (error instanceof CliError) {
      for (const detail of error.details) this.detail(detail);
      if (error.hint) this.detail(this.#paint("dim", error.hint, this.#errColor));
    }
  }
}
