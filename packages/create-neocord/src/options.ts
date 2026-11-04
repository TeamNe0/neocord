import type { PackageManager } from "./package-manager.ts";

export const DATABASES = ["none", "drizzle", "prisma"] as const;
export type Database = (typeof DATABASES)[number];

export const DIALECTS = ["sqlite", "postgres", "mysql"] as const;
export type Dialect = (typeof DIALECTS)[number];

export const DEFAULT_PROJECT_NAME = "my-neocord-bot";
export const DEFAULT_DIALECT: Dialect = "sqlite";

export interface ProjectOptions {
  projectName: string;
  targetDir: string;
  database: Database;
  dialect: Dialect | null;
  eslint: boolean;
  packageManager: PackageManager;
  git: boolean;
  install: boolean;
  overwrite: boolean;
}
