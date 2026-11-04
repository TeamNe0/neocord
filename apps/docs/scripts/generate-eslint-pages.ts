import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLINT_RULES, type EslintExample, type EslintRule } from "../src/data/eslint-rules.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../src/content/eslint/rules");

const CATEGORY_NAMES: Record<EslintRule["category"], string> = {
  "file-contracts": "File contracts",
  ui: "UI",
  "best-practices": "Best practices",
};

function fence(language: string, code: string, title?: string): string {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((match) => match[0].length));
  const ticks = "`".repeat(longest + 1);
  const meta = title === undefined ? "" : ` title="${title}"`;
  return `${ticks}${language}${meta}\n${code}\n${ticks}`;
}

function examples(items: readonly EslintExample[]): string {
  return items
    .map((item) => {
      const language = item.language ?? "tsx";
      const note = item.note === undefined ? "" : `${item.note}\n\n`;
      return `${note}${fence(language, item.code, item.filename)}`;
    })
    .join("\n\n");
}

function page(rule: EslintRule): string {
  const severity = `\`${rule.recommended}\` in \`recommended\`, \`error\` in \`strict\``;
  const fixes = [
    rule.fixable ? "Has an autofix for `eslint --fix`." : null,
    rule.suggestions ? "Offers editor suggestions." : null,
  ].filter((entry): entry is string => entry !== null);

  const messages = Object.entries(rule.messages)
    .map(([id, text]) => `### \`${id}\`\n\n${fence("text", text)}`)
    .join("\n\n");

  return [
    `| | |`,
    `| --- | --- |`,
    `| Rule id | \`neocord/${rule.name}\` |`,
    `| Category | ${CATEGORY_NAMES[rule.category]} |`,
    `| Severity | ${severity} |`,
    fixes.length > 0 ? `| Fixes | ${fixes.join(" ")} |` : null,
    "",
    "## Why",
    "",
    rule.why,
    "",
    "## Messages",
    "",
    messages,
    "",
    "## Incorrect",
    "",
    examples(rule.incorrect),
    "",
    "## Correct",
    "",
    examples(rule.correct),
    "",
    "## Turn it off",
    "",
    fence(
      "js",
      `export default [\n  neocord.configs.recommended,\n  { rules: { "neocord/${rule.name}": "off" } },\n];`,
      "eslint.config.js",
    ),
    "",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const rule of ESLINT_RULES) {
  writeFileSync(join(outDir, `${rule.name}.mdx`), page(rule));
}
process.stdout.write(`Generated ${ESLINT_RULES.length} ESLint rule pages.\n`);
