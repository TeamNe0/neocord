import { ESLINT_RULE_INDEX } from "./eslint-rule-index.ts";

export interface PageDef {
  path: string;
  title: string;
  description: string;
  file: string;
}

export interface NavEntry extends PageDef {
  children?: PageDef[];
}

export interface NavGroup {
  title: string;
  pages: NavEntry[];
}

export const NAV: NavGroup[] = [
  {
    title: "Getting started",
    pages: [
      {
        path: "/docs",
        title: "Introduction",
        description: "What neocord is, why it exists, and a small complete example of a command with a button.",
        file: "getting-started/introduction",
      },
      {
        path: "/docs/quick-start",
        title: "Quick start with the CLI",
        description: "Scaffold a bot with create-neocord, get a token from the Discord Developer Portal, invite the bot and run /ping.",
        file: "getting-started/quick-start",
      },
      {
        path: "/docs/manual-setup",
        title: "Manual setup",
        description: "Set up a neocord project by hand, from mkdir to a working bot, with every file in full.",
        file: "getting-started/manual-setup",
      },
      {
        path: "/docs/project-structure",
        title: "Project structure",
        description: "Every file and folder convention in a neocord project, and what each one does.",
        file: "getting-started/project-structure",
      },
    ],
  },
  {
    title: "Routing",
    pages: [
      {
        path: "/docs/routing",
        title: "Routing overview",
        description: "How file paths become slash commands, custom ids, events and tasks.",
        file: "routing/overview",
      },
      {
        path: "/docs/routing/features",
        title: "Features",
        description: "Group related routes into features, switch them on and off, and add intents with defineFeature.",
        file: "routing/features",
      },
      {
        path: "/docs/routing/commands",
        title: "Slash commands",
        description: "Define slash commands, subcommands and subcommand groups with defineCommand and defineGroup.",
        file: "routing/commands",
      },
      {
        path: "/docs/routing/options",
        title: "Options",
        description: "Every command option type, how values are inferred, choices, autocomplete and limits.",
        file: "routing/options",
      },
      {
        path: "/docs/routing/context-menus",
        title: "Context menus",
        description: "User and message commands with defineUserCommand and defineMessageCommand.",
        file: "routing/context-menus",
      },
      {
        path: "/docs/routing/buttons",
        title: "Buttons",
        description: "Handle button clicks with defineButton, and choose whether a click updates or replies.",
        file: "routing/buttons",
      },
      {
        path: "/docs/routing/selects",
        title: "Selects",
        description: "Handle string, user, role, channel and mentionable selects with defineSelect.",
        file: "routing/selects",
      },
      {
        path: "/docs/routing/modals",
        title: "Modals",
        description: "Define modals with defineModal, parse submissions with a schema and read typed values.",
        file: "routing/modals",
      },
      {
        path: "/docs/routing/dynamic-routes",
        title: "Dynamic routes",
        description: "Use [param] and [...rest] segments, how custom ids are built, and the typed route prop.",
        file: "routing/dynamic-routes",
      },
      {
        path: "/docs/routing/events",
        title: "Events",
        description: "Listen to discord.js client events with defineEvent, and the intents each event needs.",
        file: "routing/events",
      },
      {
        path: "/docs/routing/tasks",
        title: "Tasks",
        description: "Run code on an interval with defineTask, on the first shard or on every shard.",
        file: "routing/tasks",
      },
    ],
  },
  {
    title: "Handlers",
    pages: [
      {
        path: "/docs/handlers/context",
        title: "Handler context",
        description: "The full API of the ctx object that every handler receives.",
        file: "handlers/context",
      },
      {
        path: "/docs/handlers/replying",
        title: "Replying",
        description: "Return JSX or call ctx.reply, the reply state machine, ephemeral messages, autoDefer, followUp and update.",
        file: "handlers/replying",
      },
      {
        path: "/docs/handlers/middleware",
        title: "Middleware",
        description: "Run code before handlers with defineMiddleware, narrow by interaction kind and short-circuit with JSX.",
        file: "handlers/middleware",
      },
      {
        path: "/docs/handlers/layouts",
        title: "Layouts",
        description: "Wrap handler output in shared components with layout.tsx files.",
        file: "handlers/layouts",
      },
      {
        path: "/docs/handlers/error-boundaries",
        title: "Error boundaries",
        description: "Show a useful ephemeral message when a handler throws, with error.tsx files.",
        file: "handlers/error-boundaries",
      },
      {
        path: "/docs/handlers/loading",
        title: "Loading UI",
        description: "Send a placeholder straight away from loading.tsx and replace it with the handler's result.",
        file: "handlers/loading",
      },
      {
        path: "/docs/handlers/app-context",
        title: "App context",
        description: "Create shared services such as a database in src/context.ts and read them from ctx.app.",
        file: "handlers/app-context",
      },
    ],
  },
  {
    title: "React UI",
    pages: [
      {
        path: "/docs/ui",
        title: "UI overview",
        description: "How the @neocord/react renderer turns JSX into Components V2 payloads, and why it has no embeds.",
        file: "ui/overview",
      },
      {
        path: "/docs/ui/layout",
        title: "Layout components",
        description: "Message, Container, Section, TextDisplay, Separator, ActionRow, MediaGallery, MediaItem, Thumbnail and File, with every prop and limit.",
        file: "ui/layout",
      },
      {
        path: "/docs/ui/interactive",
        title: "Interactive components",
        description: "Button, StringSelect, Option, UserSelect, RoleSelect, MentionableSelect and ChannelSelect, with every prop and limit.",
        file: "ui/interactive",
      },
      {
        path: "/docs/ui/modal",
        title: "Modal components",
        description: "Modal, Label, TextInput, FileUpload, RadioGroup, CheckboxGroup and Checkbox, with every prop and limit.",
        file: "ui/modal",
      },
      {
        path: "/docs/ui/inline",
        title: "Inline text components",
        description: "Bold, Italic, Code, Heading, Link, List, mentions, Timestamp, Emoji and the rest of the text components.",
        file: "ui/inline",
      },
      {
        path: "/docs/ui/custom-components",
        title: "Custom components",
        description: "Write your own components, and use hooks, context and Suspense inside them.",
        file: "ui/custom-components",
      },
      {
        path: "/docs/ui/live-sessions",
        title: "Live sessions",
        description: "Stateful messages with onClick, onSelect and useState, and how TTL, process limits and restarts behave.",
        file: "ui/live-sessions",
      },
      {
        path: "/docs/ui/attachments",
        title: "Attachments",
        description: "Send buffers and files with File, Thumbnail and MediaItem, and how attachment:// works.",
        file: "ui/attachments",
      },
      {
        path: "/docs/ui/standalone",
        title: "Using @neocord/react standalone",
        description: "Use the renderer with plain discord.js and no neocord runtime.",
        file: "ui/standalone",
      },
    ],
  },
  {
    title: "Type safety",
    pages: [
      {
        path: "/docs/type-safety",
        title: "How type safety works",
        description: "Route type generation, RegisteredRoutes, RegisteredApp and what each one checks.",
        file: "type-safety/overview",
      },
      {
        path: "/docs/type-safety/environment",
        title: "Environment variables",
        description: "Validate environment variables with T3 Env and zod in src/env.ts.",
        file: "type-safety/environment",
      },
    ],
  },
  {
    title: "Database",
    pages: [
      {
        path: "/docs/database/drizzle",
        title: "Drizzle",
        description: "Use Drizzle ORM with SQLite, PostgreSQL or MySQL in a neocord bot.",
        file: "database/drizzle",
      },
      {
        path: "/docs/database/prisma",
        title: "Prisma",
        description: "Use Prisma with SQLite, PostgreSQL or MySQL in a neocord bot.",
        file: "database/prisma",
      },
    ],
  },
  {
    title: "Sharding",
    pages: [
      {
        path: "/docs/sharding",
        title: "Sharding",
        description: "How neocord shards, the sharding config, ctx.shards, process and worker modes, and scaling advice.",
        file: "sharding/sharding",
      },
    ],
  },
  {
    title: "Tooling",
    pages: [
      {
        path: "/docs/cli",
        title: "CLI reference",
        description: "Every neocord command and flag, env file order, SKIP_ENV_VALIDATION and the generated .neocord folder.",
        file: "tooling/cli",
      },
      {
        path: "/docs/eslint",
        title: "ESLint",
        description: "Set up @neocord/eslint-plugin, choose a config, and see what every rule checks.",
        file: "tooling/eslint",
        children: ESLINT_RULE_INDEX.map((rule) => ({
          path: `/docs/eslint/${rule.name}`,
          title: rule.name,
          description: rule.description,
          file: `eslint/rules/${rule.name}`,
        })),
      },
      {
        path: "/docs/testing",
        title: "Testing",
        description: "Validate routes with neocord test, and run handlers with the neocord/testing harness.",
        file: "tooling/testing",
      },
    ],
  },
  {
    title: "Deployment",
    pages: [
      {
        path: "/docs/deployment/checklist",
        title: "Production checklist",
        description: "What to check before you run a neocord bot in production.",
        file: "deployment/checklist",
      },
      {
        path: "/docs/deployment/deploying-commands",
        title: "Deploying commands",
        description: "Register commands with Discord using neocord deploy, guild and global scope, and automatic deploys.",
        file: "deployment/deploying-commands",
      },
      {
        path: "/docs/deployment/docker",
        title: "Docker",
        description: "Build and run a neocord bot with the Dockerfile from the template.",
        file: "deployment/docker",
      },
      {
        path: "/docs/deployment/process-managers",
        title: "Process managers",
        description: "Keep a bot running with systemd or pm2, and how neocord handles signals.",
        file: "deployment/process-managers",
      },
      {
        path: "/docs/deployment/hosting",
        title: "Hosting notes",
        description: "What a host needs to run a neocord bot: a long-running process, outbound access and enough memory.",
        file: "deployment/hosting",
      },
      {
        path: "/docs/deployment/upgrading",
        title: "Upgrading",
        description: "Upgrade neocord packages and check that a project still builds and deploys.",
        file: "deployment/upgrading",
      },
    ],
  },
  {
    title: "Help",
    pages: [
      {
        path: "/docs/troubleshooting",
        title: "Troubleshooting and FAQ",
        description: "Fixes for invalid tokens, disallowed intents, the three second limit, unknown interactions, missing commands and TypeScript 7 with ESLint.",
        file: "troubleshooting/troubleshooting",
      },
    ],
  },
  {
    title: "API reference",
    pages: [
      {
        path: "/docs/api/neocord",
        title: "neocord",
        description: "API reference for the neocord package: define helpers, option, useContext, parseDuration and types.",
        file: "api/neocord",
      },
      {
        path: "/docs/api/runtime",
        title: "neocord/runtime",
        description: "API reference for neocord/runtime: startBot, startManager, serializeCommands, deployCommands and validateManifest.",
        file: "api/runtime",
      },
      {
        path: "/docs/api/testing",
        title: "neocord/testing",
        description: "API reference for neocord/testing: run helpers, mocks and TestResult.",
        file: "api/testing",
      },
      {
        path: "/docs/api/react",
        title: "@neocord/react",
        description: "API reference for @neocord/react: render functions, live roots, components and types.",
        file: "api/react",
      },
      {
        path: "/docs/api/routing",
        title: "@neocord/routing",
        description: "API reference for @neocord/routing: classifyFile, buildCustomId, createRouter and route types.",
        file: "api/routing",
      },
      {
        path: "/docs/api/eslint-plugin",
        title: "@neocord/eslint-plugin",
        description: "API reference for @neocord/eslint-plugin: configs, settings, rules and exported types.",
        file: "api/eslint-plugin",
      },
      {
        path: "/docs/api/create-neocord",
        title: "create-neocord",
        description: "API reference for create-neocord: arguments, flags, exit behaviour and the generated project.",
        file: "api/create-neocord",
      },
    ],
  },
];

export const ALL_PAGES: PageDef[] = NAV.flatMap((group) =>
  group.pages.flatMap((page) => {
    const { children, ...self } = page;
    return [self, ...(children ?? [])];
  }),
);

const BY_PATH = new Map(ALL_PAGES.map((page) => [page.path, page]));

export function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function findPage(pathname: string): PageDef | undefined {
  return BY_PATH.get(normalizePath(pathname));
}

export function groupOf(path: string): string | undefined {
  return NAV.find((group) =>
    group.pages.some((page) => page.path === path || page.children?.some((child) => child.path === path)),
  )?.title;
}

export function neighbours(path: string): { previous?: PageDef; next?: PageDef } {
  const index = ALL_PAGES.findIndex((page) => page.path === path);
  if (index === -1) return {};
  const previous = ALL_PAGES[index - 1];
  const next = ALL_PAGES[index + 1];
  return { ...(previous ? { previous } : {}), ...(next ? { next } : {}) };
}

export const HOME_META = {
  path: "/",
  title: "neocord: file routes and JSX for Discord bots",
  description:
    "A file-routed framework for Discord bots, built on discord.js and React. Write commands, buttons, modals, events and tasks as files, and return JSX from handlers.",
};

export const NOT_FOUND_META = {
  path: "/404",
  title: "Page not found",
  description: "This page does not exist. Find what you need in the neocord documentation.",
};
