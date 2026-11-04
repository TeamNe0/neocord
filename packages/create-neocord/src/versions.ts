export const catalogVersions = {
  "@t3-oss/env-core": "^0.13.11",
  "@types/bun": "latest",
  "@types/node": "^26.6.6",
  "@types/react": "^19.3.0",
  "@typescript-eslint/parser": "^8.72.1",
  "@typescript/native": "npm:typescript@^7.0.2",
  "discord.js": "^14.28.1",
  dotenv: "^18.0.9",
  eslint: "^10.14.0",
  react: "^19.3.1",
  typescript: "npm:@typescript/typescript6@^6.0.2",
  zod: "^4.6.7",
} as const;

export const frameworkVersions = {
  "@teamneo/neocord-cli": "^0.1.0",
  "@teamneo/neocord-eslint-plugin": "^0.1.0",
  "@teamneo/neocord-react": "^0.1.0",
  neocord: "^0.1.0",
} as const;

export const databaseVersions = {
  "@libsql/client": "^0.18.0",
  "@prisma/adapter-libsql": "^7.10.1",
  "@prisma/adapter-mariadb": "^7.10.1",
  "@prisma/adapter-pg": "^7.10.1",
  "@prisma/client": "^7.10.1",
  "drizzle-kit": "^0.31.11",
  "drizzle-orm": "^0.45.4",
  mysql2: "^3.24.6",
  postgres: "^4.0.0",
  prisma: "^7.10.1",
} as const;

export const dependencyVersionMap = {
  ...catalogVersions,
  ...frameworkVersions,
  ...databaseVersions,
} as const;

export type AvailableDependency = keyof typeof dependencyVersionMap;

export const VERSION_OVERRIDES_ENV = "NEOCORD_TEMPLATE_VERSION_OVERRIDES";

export function parseVersionOverrides(env: NodeJS.ProcessEnv): Record<string, string> {
  const raw = env[VERSION_OVERRIDES_ENV];
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${VERSION_OVERRIDES_ENV} must be valid JSON.`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${VERSION_OVERRIDES_ENV} must be a JSON object mapping dependency names to version specs.`);
  }

  const overrides: Record<string, string> = {};
  for (const [name, spec] of Object.entries(parsed)) {
    if (typeof spec !== "string") {
      throw new Error(`${VERSION_OVERRIDES_ENV} has a non-string spec for "${name}".`);
    }
    overrides[name] = spec;
  }
  return overrides;
}

export function resolveVersion(name: AvailableDependency, overrides: Readonly<Record<string, string>>): string {
  return overrides[name] ?? dependencyVersionMap[name];
}
