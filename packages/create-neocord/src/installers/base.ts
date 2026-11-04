import { resolveVersion } from "../versions.ts";
import { addDependencies, addDevDependencies, copyTemplate, type Installer, replaceInFile } from "./shared.ts";

export const baseInstaller: Installer = async (context) => {
  await copyTemplate(context, "base");

  addDependencies(context, ["@teamneo/neocord-react", "@t3-oss/env-core", "discord.js", "neocord", "react", "zod"]);
  addDevDependencies(context, ["@teamneo/neocord-cli", "@types/node", "@types/react"]);

  if (context.options.eslint) {
    addDevDependencies(context, ["@typescript/native", "typescript"]);
  } else {
    context.packageJson.devDependencies.typescript = resolveVersion("@typescript/native", context.versionOverrides);
  }

  if (context.options.packageManager === "bun") {
    addDevDependencies(context, ["@types/bun"]);
    await replaceInFile(context, "tsconfig.json", '"types": ["node"]', '"types": ["node", "bun"]');
  }

  Object.assign(context.packageJson.scripts, {
    dev: "neocord dev",
    build: "neocord build",
    start: "neocord start",
    deploy: "neocord deploy",
    test: "neocord test",
    typecheck: "neocord typegen && tsc --noEmit",
  });
};
