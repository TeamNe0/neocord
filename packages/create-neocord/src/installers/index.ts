import type { ProjectOptions } from "../options.ts";
import { baseInstaller } from "./base.ts";
import { drizzleInstaller } from "./drizzle.ts";
import { eslintInstaller } from "./eslint.ts";
import { prismaInstaller } from "./prisma.ts";
import type { Installer } from "./shared.ts";

export type { Installer, InstallerContext, PackageJsonDraft } from "./shared.ts";

export interface InstallerEntry {
  name: string;
  inUse: boolean;
  install: Installer;
}

export function buildInstallers(options: ProjectOptions): InstallerEntry[] {
  return [
    { name: "base", inUse: true, install: baseInstaller },
    { name: "eslint", inUse: options.eslint, install: eslintInstaller },
    { name: "drizzle", inUse: options.database === "drizzle", install: drizzleInstaller },
    { name: "prisma", inUse: options.database === "prisma", install: prismaInstaller },
  ];
}
