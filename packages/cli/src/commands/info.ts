import { arch, platform, release } from "node:os";
import { errorMessage } from "../errors.ts";
import { loadConfig } from "../project/config.ts";
import { applyEnv, loadEnvFiles } from "../project/env.ts";
import { locateProject, resolveCwd } from "../project/paths.ts";
import { readInstalledVersion, resolveRuntime } from "../project/runtime.ts";
import type { Ui } from "../ui.ts";

export interface InfoCommandOptions {
  cwd?: string | undefined;
  cliVersion: string;
}

const REPORTED_PACKAGES = ["neocord", "@neocord/react", "@neocord/routing", "discord.js", "react"] as const;

export async function runInfo(options: InfoCommandOptions, ui: Ui): Promise<number> {
  const start = resolveCwd(options.cwd);
  const location = locateProject(start);
  const searchRoot = location?.root ?? start;

  const rows: [string, string][] = [["@neocord/cli", options.cliVersion]];
  for (const name of REPORTED_PACKAGES) {
    rows.push([name, readInstalledVersion(searchRoot, name) ?? "not installed"]);
  }

  let runtime = "not available";
  let tokenSet = Boolean(process.env.DISCORD_TOKEN);
  if (location) {
    const loaded = loadEnvFiles({ root: location.root, mode: "development", skipValidation: true });
    applyEnv(process.env, loaded.env);
    tokenSet = Boolean(loaded.env.DISCORD_TOKEN);
    try {
      const { config } = await loadConfig({ root: location.root, configFile: location.configFile });
      const resolved = resolveRuntime(config.runtime);
      runtime = `${resolved.name} (config: ${config.runtime})`;
    } catch (error) {
      runtime = `unknown (${errorMessage(error)})`;
    }
  }

  rows.push(
    ["runtime", runtime],
    ["node", process.versions.node],
    ["bun", process.versions.bun ?? "not running under bun"],
    ["os", `${platform()} ${release()} ${arch()}`],
    ["project", location?.root ?? "not found"],
    ["DISCORD_TOKEN", tokenSet ? "set" : "not set"],
  );

  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) {
    ui.print(`${ui.style("bold", label.padEnd(width))}  ${value}`);
  }
  return 0;
}
