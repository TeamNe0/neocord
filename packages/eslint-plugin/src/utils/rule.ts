import type { Rule, Scope, SourceCode } from "eslint";
import type { AstNode } from "./ast.ts";
import { describeFile, type LintedFile } from "./project.ts";

export type MessageData = Record<string, string | number>;

export interface RuleSuggestion {
  readonly messageId: string;
  readonly data?: MessageData;
  readonly fix: Rule.ReportFixer;
}

export interface RuleReport {
  readonly node: AstNode;
  readonly messageId: string;
  readonly data?: MessageData;
  readonly fix?: Rule.ReportFixer;
  readonly suggest?: readonly RuleSuggestion[];
}

export interface RuleKit {
  readonly file: LintedFile;
  report(report: RuleReport): void;
  scope(node: AstNode): Scope.Scope;
  text(node: AstNode): string;
}

export type RuleVisitors = Record<string, (node: AstNode) => void>;

export interface RuleDefinitionInput {
  readonly name: string;
  readonly type: "problem" | "suggestion";
  readonly description: string;
  readonly messages: Record<string, string>;
  readonly fixable?: "code";
  readonly hasSuggestions?: boolean;
  create(kit: RuleKit): RuleVisitors;
}

export const DOCS_BASE_URL = "https://neocord.dev/docs/eslint";

export function createRule(definition: RuleDefinitionInput): Rule.RuleModule {
  return {
    meta: {
      type: definition.type,
      docs: {
        description: definition.description,
        url: `${DOCS_BASE_URL}/${definition.name}`,
      },
      messages: definition.messages,
      schema: [],
      ...(definition.fixable ? { fixable: definition.fixable } : {}),
      ...(definition.hasSuggestions ? { hasSuggestions: true } : {}),
    },
    create(context) {
      let file: LintedFile | undefined;
      const { sourceCode } = context;
      const kit: RuleKit = {
        get file() {
          file ??= describeFile(context.cwd, context.filename, context.settings);
          return file;
        },
        report(report) {
          context.report(report as unknown as Rule.ReportDescriptor);
        },
        scope(node) {
          return sourceCode.getScope(node as unknown as Parameters<SourceCode["getScope"]>[0]);
        },
        text(node) {
          return sourceCode.getText(node as unknown as Parameters<SourceCode["getText"]>[0]);
        },
      };
      return definition.create(kit) as unknown as Rule.RuleListener;
    },
  };
}
