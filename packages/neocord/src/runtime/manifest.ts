import { createRouter, type RouteKind, type Router } from "@neocord/routing";
import type { ComponentType } from "react";
import type { IntentName, PartialName } from "../config.ts";
import { parseDuration } from "../duration.ts";
import type {
  ButtonDefinition,
  CommandDefinition,
  CommandInfo,
  ContextDefinition,
  ErrorProps,
  EventDefinition,
  FeatureDefinition,
  GroupDefinition,
  LayoutProps,
  Manifest,
  ManifestRoute,
  MessageCommandDefinition,
  MiddlewareDefinition,
  ModalDefinition,
  ModuleNamespace,
  SelectDefinition,
  TaskDefinition,
  UserCommandDefinition,
} from "../types.ts";
import type { CompiledMiddleware } from "./middleware.ts";

export type {
  Manifest,
  ManifestFeature,
  ManifestGroup,
  ManifestModule,
  ManifestRoute,
  ModuleNamespace,
} from "../types.ts";

export interface DefinitionByKind {
  command: CommandDefinition;
  "user-command": UserCommandDefinition;
  "message-command": MessageCommandDefinition;
  button: ButtonDefinition;
  select: SelectDefinition;
  modal: ModalDefinition;
  event: EventDefinition;
  task: TaskDefinition;
}

export type AnyDefinition = DefinitionByKind[RouteKind];

export function brandOf(module: ModuleNamespace | null | undefined): string | undefined {
  const value = module?.default;
  if (typeof value !== "object" || value === null) return undefined;
  const brand = (value as { __neocord?: unknown }).__neocord;
  return typeof brand === "string" ? brand : undefined;
}

export function defaultExport<K extends RouteKind>(route: ManifestRoute & { kind: K }): DefinitionByKind[K] {
  if (brandOf(route.module) !== route.kind) {
    throw new Error(
      `${route.file} must default export ${describeHelper(route.kind)}, but its default export has no "${route.kind}" brand.`,
    );
  }
  return route.module.default as DefinitionByKind[K];
}

export function describeHelper(kind: string): string {
  const helpers: Record<string, string> = {
    command: "defineCommand(...)",
    "user-command": "defineUserCommand(...)",
    "message-command": "defineMessageCommand(...)",
    button: "defineButton(...)",
    select: "defineSelect(...)",
    modal: "defineModal(...)",
    event: "defineEvent(...)",
    task: "defineTask(...)",
    group: "defineGroup(...)",
    feature: "defineFeature(...)",
    context: "defineContext(...)",
    middleware: "defineMiddleware(...)",
  };
  return helpers[kind] ?? kind;
}

export function featureDefinition(module: ModuleNamespace | null): FeatureDefinition | null {
  return brandOf(module) === "feature" ? (module?.default as FeatureDefinition) : null;
}

export function contextDefinition(module: ModuleNamespace | null): ContextDefinition | null {
  return brandOf(module) === "context" ? (module?.default as ContextDefinition) : null;
}

export function groupDefinition(module: ModuleNamespace): GroupDefinition | null {
  return brandOf(module) === "group" ? (module.default as GroupDefinition) : null;
}

export function disabledFeatures(manifest: Manifest): Set<string> {
  const disabled = new Set<string>();
  for (const { name, module } of manifest.features) {
    if (featureDefinition(module)?.enabled === false) disabled.add(name);
  }
  return disabled;
}

export function enabledManifest(manifest: Manifest): Manifest {
  const disabled = disabledFeatures(manifest);
  if (disabled.size === 0) return manifest;
  return {
    ...manifest,
    features: manifest.features.filter(({ name }) => !disabled.has(name)),
    groups: manifest.groups.filter(({ feature }) => !disabled.has(feature)),
    routes: manifest.routes.filter(({ feature }) => !disabled.has(feature)),
  };
}

export function mergedIntents(manifest: Manifest, configured: readonly IntentName[] = ["Guilds"]): IntentName[] {
  const merged = new Set<IntentName>(configured);
  for (const { module } of enabledManifest(manifest).features) {
    for (const intent of featureDefinition(module)?.intents ?? []) merged.add(intent);
  }
  return [...merged];
}

export function mergedPartials(manifest: Manifest, configured: readonly PartialName[] = []): PartialName[] {
  const merged = new Set<PartialName>(configured);
  for (const { module } of enabledManifest(manifest).features) {
    for (const partial of featureDefinition(module)?.partials ?? []) merged.add(partial);
  }
  return [...merged];
}

export interface CompiledRoute<K extends RouteKind = RouteKind> {
  kind: K;
  id: string;
  feature: string;
  file: string;
  segments: readonly string[];
  definition: DefinitionByKind[K];
  middleware: readonly CompiledMiddleware[];
  layouts: readonly ComponentType<LayoutProps>[];
  error: ComponentType<ErrorProps> | null;
  loading: ComponentType | null;
  permissions: readonly NonNullable<GroupDefinition["permissions"]>[number][];
  guildOnly: boolean;
  cooldownMs: number | null;
}

export interface CompiledManifest {
  commands: Map<string, CompiledRoute<"command">>;
  userCommands: Map<string, CompiledRoute<"user-command">>;
  messageCommands: Map<string, CompiledRoute<"message-command">>;
  buttons: Router<CompiledRoute<"button">>;
  selects: Router<CompiledRoute<"select">>;
  modals: Router<CompiledRoute<"modal">>;
  modalsById: Map<string, CompiledRoute<"modal">>;
  events: CompiledRoute<"event">[];
  tasks: CompiledRoute<"task">[];
}

function componentOf<P>(file: string, module: ModuleNamespace, what: string): ComponentType<P> {
  if (typeof module.default !== "function") {
    throw new Error(`${file} must default export a React component to be used as ${what}.`);
  }
  return module.default as ComponentType<P>;
}

function middlewareOf(file: string, module: ModuleNamespace): CompiledMiddleware {
  if (brandOf(module) !== "middleware") {
    throw new Error(`${file} must default export defineMiddleware(...), but its default export has no "middleware" brand.`);
  }
  return { file, definition: module.default as MiddlewareDefinition };
}

function ancestorGroups(manifest: Manifest, route: ManifestRoute): GroupDefinition[] {
  if (route.kind !== "command") return [];
  const groups: GroupDefinition[] = [];
  for (let depth = 1; depth < route.segments.length; depth++) {
    const path = route.segments.slice(0, depth).join(" ");
    for (const group of manifest.groups) {
      if (group.segments.join(" ") !== path) continue;
      const definition = groupDefinition(group.module);
      if (definition !== null) groups.push(definition);
    }
  }
  return groups;
}

interface RouteMetadata {
  permissions?: readonly NonNullable<GroupDefinition["permissions"]>[number][];
  guildOnly?: boolean;
  cooldown?: Parameters<typeof parseDuration>[0];
}

function compileRoute<K extends RouteKind>(manifest: Manifest, route: ManifestRoute & { kind: K }): CompiledRoute<K> {
  const definition = defaultExport(route);
  const metadata = definition as RouteMetadata;
  const groups = ancestorGroups(manifest, route);
  return {
    kind: route.kind,
    id: route.id,
    feature: route.feature,
    file: route.file,
    segments: route.segments,
    definition,
    middleware: route.middleware.map(({ file, module }) => middlewareOf(file, module)),
    layouts: route.layouts.map(({ file, module }) => componentOf<LayoutProps>(file, module, "a layout")),
    error: route.error === null ? null : componentOf<ErrorProps>(route.error.file, route.error.module, "an error view"),
    loading: route.loading === null ? null : componentOf<object>(route.loading.file, route.loading.module, "a loading view"),
    permissions: [...new Set([...groups.flatMap((group) => group.permissions ?? []), ...(metadata.permissions ?? [])])],
    guildOnly: metadata.guildOnly === true || groups.some((group) => group.guildOnly === true),
    cooldownMs: metadata.cooldown === undefined ? null : parseDuration(metadata.cooldown),
  };
}

export function listCommands(compiled: CompiledManifest): CommandInfo[] {
  const shared = ({ feature, guildOnly, permissions }: CompiledRoute) => ({ feature, guildOnly, permissions });
  return [
    ...[...compiled.commands].map(
      ([name, route]): CommandInfo => ({
        kind: "command",
        name,
        description: route.definition.description,
        ...shared(route),
      }),
    ),
    ...[...compiled.userCommands].map(
      ([name, route]): CommandInfo => ({ kind: "user-command", name, description: null, ...shared(route) }),
    ),
    ...[...compiled.messageCommands].map(
      ([name, route]): CommandInfo => ({ kind: "message-command", name, description: null, ...shared(route) }),
    ),
  ].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

function isKind<K extends RouteKind>(route: ManifestRoute, kind: K): route is ManifestRoute & { kind: K } {
  return route.kind === kind;
}

export function compileManifest(manifest: Manifest): CompiledManifest {
  const compiled: CompiledManifest = {
    commands: new Map(),
    userCommands: new Map(),
    messageCommands: new Map(),
    buttons: createRouter(),
    selects: createRouter(),
    modals: createRouter(),
    modalsById: new Map(),
    events: [],
    tasks: [],
  };

  const enabled = enabledManifest(manifest);
  for (const route of enabled.routes) {
    if (isKind(route, "command")) {
      compiled.commands.set(route.segments.join(" "), compileRoute(enabled, route));
    } else if (isKind(route, "user-command")) {
      const entry = compileRoute(enabled, route);
      compiled.userCommands.set(entry.definition.name, entry);
    } else if (isKind(route, "message-command")) {
      const entry = compileRoute(enabled, route);
      compiled.messageCommands.set(entry.definition.name, entry);
    } else if (isKind(route, "button")) {
      compiled.buttons.add(route.id, compileRoute(enabled, route));
    } else if (isKind(route, "select")) {
      compiled.selects.add(route.id, compileRoute(enabled, route));
    } else if (isKind(route, "modal")) {
      const entry = compileRoute(enabled, route);
      compiled.modals.add(route.id, entry);
      compiled.modalsById.set(route.id, entry);
    } else if (isKind(route, "event")) {
      compiled.events.push(compileRoute(enabled, route));
    } else if (isKind(route, "task")) {
      compiled.tasks.push(compileRoute(enabled, route));
    }
  }
  return compiled;
}
