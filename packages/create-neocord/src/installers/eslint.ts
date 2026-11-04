import { addDevDependencies, copyTemplate, type Installer } from "./shared.ts";

export const eslintInstaller: Installer = async (context) => {
  await copyTemplate(context, "extras/eslint");
  addDevDependencies(context, ["@neocord/eslint-plugin", "@typescript-eslint/parser", "eslint"]);
  context.packageJson.scripts.lint = "neocord lint";
};
