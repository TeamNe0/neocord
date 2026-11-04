export interface EslintRuleSummary {
  name: string;
  description: string;
}

export const ESLINT_RULE_INDEX: EslintRuleSummary[] = [
  { name: "require-default-export", description: "Require the default export neocord loads from route, group, feature, context and segment files." },
  { name: "require-define-helper", description: "Require the default export of each routed file to be a call to the matching define helper." },
  { name: "route-matches-path", description: "Require the first argument of route helpers to equal the id derived from the file path." },
  { name: "no-extra-exports", description: "Allow only the default export, plus type exports, in files neocord routes." },
  { name: "no-unknown-route-file", description: "Report files in the features folder that neocord cannot classify." },
  { name: "valid-command-name", description: "Require folders under commands to be valid Discord command names within the depth limit." },
  { name: "no-command-with-subcommands", description: "Disallow a command file in a folder that also holds nested commands." },
  { name: "require-group-file", description: "Require a group file with a description in the root folder of nested commands." },
  { name: "valid-event-name", description: "Require defineEvent to name a real discord.js client event." },
  { name: "valid-command-definition", description: "Check definitions passed to define helpers against Discord and neocord requirements." },
  { name: "valid-modal-definition", description: "Require defineModal to have a usable title, render and submit." },
  { name: "no-embed-builders", description: "Disallow discord.js component builders and raw payloads in favour of @neocord/react." },
  { name: "valid-component-nesting", description: "Check the static JSX structure of @neocord/react components." },
  { name: "prefer-route-prop", description: "Prefer the typed route prop over a hardcoded customId on buttons and selects." },
  { name: "no-text-in-action-row", description: "Disallow text directly inside ActionRow, MediaGallery and select components." },
  { name: "no-direct-interaction-reply", description: "Disallow responding through ctx.interaction, which bypasses neocord's reply state and rendering." },
  { name: "no-client-instantiation", description: "Disallow creating discord.js clients or logging in from project source, because the framework owns both." },
  { name: "no-process-env", description: "Disallow process.env outside src/env.ts and root config files, so variables stay validated in one place." },
  { name: "no-hardcoded-token", description: "Disallow string literals shaped like Discord bot tokens." },
  { name: "no-blocking-calls", description: "Disallow synchronous fs and child_process calls and Atomics.wait in route files." },
  { name: "prefer-guild-only", description: "Prefer guildOnly: true over asserting ctx.guild or ctx.member are non-null." },
  { name: "no-unawaited-context-calls", description: "Require promises from ctx response methods to be awaited, returned or explicitly voided." },
  { name: "require-error-boundary", description: "Require each feature to have its own error.tsx." },
  { name: "no-mass-mentions", description: "Disallow enabling @everyone in allowedMentions and writing mass mentions in JSX text." },
];
