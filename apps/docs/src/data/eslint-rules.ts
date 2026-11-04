export type RuleSeverity = "off" | "warn" | "error";

export interface EslintExample {
  filename?: string;
  language?: string;
  note?: string;
  code: string;
}

export interface EslintRule {
  name: string;
  category: "file-contracts" | "ui" | "best-practices";
  recommended: RuleSeverity;
  fixable?: boolean;
  suggestions?: boolean;
  description: string;
  why: string;
  messages: Record<string, string>;
  incorrect: EslintExample[];
  correct: EslintExample[];
}

export const ESLINT_RULES: EslintRule[] = [];
