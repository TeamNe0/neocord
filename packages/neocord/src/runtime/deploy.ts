import { REST, Routes, type RESTGetAPIOAuth2CurrentApplicationResult, type RESTPutAPIApplicationCommandsJSONBody } from "discord.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { NeocordConfig } from "../config.ts";
import { createLogger, resolveLogLevel } from "../logger.ts";
import type { Manifest } from "../types.ts";
import { serializeCommands } from "./commands.ts";
import { validateManifest } from "./validate.ts";

export interface DeployOptions {
  config: NeocordConfig;
  manifest: Manifest;
  guildId?: string | undefined;
  force?: boolean | undefined;
  dryRun?: boolean | undefined;
  clear?: boolean | undefined;
  stateFile?: string | undefined;
}

export interface DeployResult {
  status: "deployed" | "unchanged" | "dry-run" | "cleared";
  scope: "global" | "guild";
  guildId?: string;
  commandCount: number;
  hash: string;
  commands: unknown[];
}

export interface DeployRest {
  setToken(token: string): unknown;
  get(route: `/${string}`): Promise<unknown>;
  put(route: `/${string}`, options: { body: unknown }): Promise<unknown>;
}

interface DeployStateEntry {
  applicationId?: string;
  hash: string;
  commandCount: number;
  deployedAt: string;
}

interface DeployState {
  version: 1;
  scopes: Record<string, DeployStateEntry>;
}

function scopeKey(guildId: string | undefined): string {
  return guildId === undefined ? "global" : `guild:${guildId}`;
}

function hashPayload(commands: unknown, guildId: string | undefined): string {
  return createHash("sha256")
    .update(JSON.stringify({ scope: scopeKey(guildId), commands }))
    .digest("hex");
}

function guildPayload(commands: RESTPutAPIApplicationCommandsJSONBody): RESTPutAPIApplicationCommandsJSONBody {
  return commands.map((command) => {
    const { contexts: _contexts, integration_types: _integrationTypes, ...rest } = command;
    return rest;
  });
}

async function readState(path: string | undefined): Promise<DeployState> {
  const empty: DeployState = { version: 1, scopes: {} };
  if (path === undefined) return empty;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<DeployState>;
    if (parsed.version !== 1 || typeof parsed.scopes !== "object" || parsed.scopes === null) return empty;
    const scopes = Object.entries(parsed.scopes).filter(
      ([, entry]) => typeof entry === "object" && entry !== null && typeof entry.hash === "string",
    );
    return { version: 1, scopes: Object.fromEntries(scopes) };
  } catch {
    return empty;
  }
}

export function applicationIdFromToken(token: string): string | null {
  const segment = token.replace(/^Bot\s+/i, "").split(".")[0] ?? "";
  const decoded = Buffer.from(segment, "base64").toString("utf8");
  return /^\d{15,25}$/.test(decoded) ? decoded : null;
}

async function writeState(path: string, state: DeployState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
}

export function resolveToken(config: NeocordConfig): string | undefined {
  const token = config.token ?? process.env.DISCORD_TOKEN;
  return typeof token === "string" && token.trim() !== "" ? token.trim() : undefined;
}

export const MISSING_TOKEN_MESSAGE =
  "No Discord bot token found. Set DISCORD_TOKEN in your environment or pass token in neocord.config.ts. You can create one at https://discord.com/developers/applications under Bot > Reset Token.";

export async function deployWithRest(options: DeployOptions, createRest: () => DeployRest): Promise<DeployResult> {
  const { config, manifest, guildId, force = false, dryRun = false, clear = false, stateFile } = options;

  if (!clear) {
    const errors = validateManifest(manifest, config).filter((issue) => issue.severity === "error");
    if (errors.length > 0) {
      throw new Error(
        `Cannot deploy commands, the manifest has errors:\n${errors.map((issue) => `  ${issue.file}: ${issue.message}`).join("\n")}`,
      );
    }
  }

  const serialized: RESTPutAPIApplicationCommandsJSONBody = clear ? [] : serializeCommands(manifest);
  const commands = guildId === undefined ? serialized : guildPayload(serialized);
  const hash = hashPayload(commands, guildId);
  const base = {
    scope: guildId === undefined ? ("global" as const) : ("guild" as const),
    ...(guildId === undefined ? {} : { guildId }),
    commandCount: commands.length,
    hash,
    commands,
  };

  if (dryRun) return { status: "dry-run", ...base };

  const state = await readState(stateFile);
  const key = scopeKey(guildId);
  const recorded = state.scopes[key];
  const token = resolveToken(config);
  const hashMatches = !clear && !force && recorded?.hash === hash;
  if (hashMatches && token === undefined && recorded?.applicationId !== undefined) return { status: "unchanged", ...base };
  if (token === undefined) throw new Error(MISSING_TOKEN_MESSAGE);

  const tokenApplicationId = applicationIdFromToken(token);
  if (hashMatches && tokenApplicationId !== null && recorded?.applicationId === tokenApplicationId) {
    return { status: "unchanged", ...base };
  }

  const rest = createRest();
  rest.setToken(token);

  let applicationId: string;
  try {
    const application = (await rest.get(Routes.oauth2CurrentApplication())) as RESTGetAPIOAuth2CurrentApplicationResult;
    applicationId = application.id;
  } catch (error) {
    if ((error as { status?: unknown }).status === 401) {
      throw new Error(
        "Discord rejected the bot token while deploying commands. Reset it at https://discord.com/developers/applications under Bot > Reset Token, then update DISCORD_TOKEN.",
        { cause: error },
      );
    }
    throw error;
  }

  const stateApplicationId = tokenApplicationId ?? applicationId;
  if (hashMatches && recorded?.applicationId === stateApplicationId) return { status: "unchanged", ...base };

  await rest.put(
    guildId === undefined
      ? Routes.applicationCommands(applicationId)
      : Routes.applicationGuildCommands(applicationId, guildId),
    { body: commands },
  );

  if (stateFile !== undefined) {
    if (clear) {
      delete state.scopes[key];
    } else {
      state.scopes[key] = {
        applicationId: stateApplicationId,
        hash,
        commandCount: commands.length,
        deployedAt: new Date().toISOString(),
      };
    }
    await writeState(stateFile, state);
  }

  const scopeName = guildId === undefined ? "the global scope" : `guild ${guildId}`;
  createLogger({ level: resolveLogLevel(config.logLevel), scope: "deploy", secrets: [token] }).info(
    clear ? `Removed all commands from ${scopeName}.` : `Deployed ${commands.length} commands to ${scopeName}.`,
  );

  return { status: clear ? "cleared" : "deployed", ...base };
}

export function deployCommands(options: DeployOptions): Promise<DeployResult> {
  return deployWithRest(options, () => new REST() as unknown as DeployRest);
}
