import { readFileSync } from "node:fs";
import type { ESLint, Linter, Rule } from "eslint";
import noBlockingCalls from "./rules/no-blocking-calls.ts";
import noClientInstantiation from "./rules/no-client-instantiation.ts";
import noCommandWithSubcommands from "./rules/no-command-with-subcommands.ts";
import noDirectInteractionReply from "./rules/no-direct-interaction-reply.ts";
import noEmbedBuilders from "./rules/no-embed-builders.ts";
import noExtraExports from "./rules/no-extra-exports.ts";
import noHardcodedToken from "./rules/no-hardcoded-token.ts";
import noMassMentions from "./rules/no-mass-mentions.ts";
import noProcessEnv from "./rules/no-process-env.ts";
import noTextInActionRow from "./rules/no-text-in-action-row.ts";
import noUnawaitedContextCalls from "./rules/no-unawaited-context-calls.ts";
import noUnknownRouteFile from "./rules/no-unknown-route-file.ts";
import preferGuildOnly from "./rules/prefer-guild-only.ts";
import preferRouteProp from "./rules/prefer-route-prop.ts";
import requireDefaultExport from "./rules/require-default-export.ts";
import requireDefineHelper from "./rules/require-define-helper.ts";
import requireErrorBoundary from "./rules/require-error-boundary.ts";
import requireGroupFile from "./rules/require-group-file.ts";
import routeMatchesPath from "./rules/route-matches-path.ts";
import validCommandDefinition from "./rules/valid-command-definition.ts";
import validCommandName from "./rules/valid-command-name.ts";
import validComponentNesting from "./rules/valid-component-nesting.ts";
import validEventName from "./rules/valid-event-name.ts";
import validModalDefinition from "./rules/valid-modal-definition.ts";

export type { NeocordSettings } from "./utils/project.ts";

export const rules = {
  "require-default-export": requireDefaultExport,
  "require-define-helper": requireDefineHelper,
  "route-matches-path": routeMatchesPath,
  "no-extra-exports": noExtraExports,
  "no-unknown-route-file": noUnknownRouteFile,
  "valid-command-name": validCommandName,
  "no-command-with-subcommands": noCommandWithSubcommands,
  "require-group-file": requireGroupFile,
  "valid-event-name": validEventName,
  "valid-command-definition": validCommandDefinition,
  "valid-modal-definition": validModalDefinition,
  "no-embed-builders": noEmbedBuilders,
  "valid-component-nesting": validComponentNesting,
  "prefer-route-prop": preferRouteProp,
  "no-text-in-action-row": noTextInActionRow,
  "no-direct-interaction-reply": noDirectInteractionReply,
  "no-client-instantiation": noClientInstantiation,
  "no-process-env": noProcessEnv,
  "no-hardcoded-token": noHardcodedToken,
  "no-blocking-calls": noBlockingCalls,
  "prefer-guild-only": preferGuildOnly,
  "no-unawaited-context-calls": noUnawaitedContextCalls,
  "require-error-boundary": requireErrorBoundary,
  "no-mass-mentions": noMassMentions,
} satisfies Record<string, Rule.RuleModule>;

export type NeocordRuleName = keyof typeof rules;

export type NeocordSeverity = "off" | "warn" | "error";

export type NeocordConfigName = "recommended" | "strict";

export interface NeocordPlugin extends ESLint.Plugin {
  meta: { name: string; version: string; namespace: string };
  rules: Record<NeocordRuleName, Rule.RuleModule>;
  configs: Record<NeocordConfigName, Linter.Config>;
}

const RECOMMENDED_SEVERITIES: Record<NeocordRuleName, NeocordSeverity> = {
  "require-default-export": "error",
  "require-define-helper": "error",
  "route-matches-path": "error",
  "no-extra-exports": "error",
  "no-unknown-route-file": "error",
  "valid-command-name": "error",
  "no-command-with-subcommands": "error",
  "require-group-file": "warn",
  "valid-event-name": "error",
  "valid-command-definition": "error",
  "valid-modal-definition": "error",
  "no-embed-builders": "warn",
  "valid-component-nesting": "error",
  "prefer-route-prop": "warn",
  "no-text-in-action-row": "error",
  "no-direct-interaction-reply": "warn",
  "no-client-instantiation": "error",
  "no-process-env": "warn",
  "no-hardcoded-token": "error",
  "no-blocking-calls": "warn",
  "prefer-guild-only": "warn",
  "no-unawaited-context-calls": "warn",
  "require-error-boundary": "off",
  "no-mass-mentions": "warn",
};

const NAMESPACE = "@neocord";
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  name: string;
  version: string;
};

function scopedRules(severity: (name: NeocordRuleName) => NeocordSeverity): Linter.RulesRecord {
  const entries = Object.keys(rules).map((name) => {
    return [`${NAMESPACE}/${name}`, severity(name as NeocordRuleName)] as const;
  });
  return Object.fromEntries(entries);
}

const plugin: NeocordPlugin = {
  meta: { name: packageJson.name, version: packageJson.version, namespace: NAMESPACE },
  rules,
  configs: {} as NeocordPlugin["configs"],
};

plugin.configs.recommended = {
  name: "@neocord/recommended",
  plugins: { [NAMESPACE]: plugin },
  rules: scopedRules((name) => RECOMMENDED_SEVERITIES[name]),
};

plugin.configs.strict = {
  name: "@neocord/strict",
  plugins: { [NAMESPACE]: plugin },
  rules: scopedRules(() => "error"),
};

export default plugin;
