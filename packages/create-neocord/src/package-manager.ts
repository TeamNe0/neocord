import { spawn } from "node:child_process";

export const PACKAGE_MANAGERS = ["bun", "npm", "pnpm", "yarn"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export const DEFAULT_PACKAGE_MANAGER: PackageManager = "bun";

function isPackageManager(value: string): value is PackageManager {
  return (PACKAGE_MANAGERS as readonly string[]).includes(value);
}

export function detectPackageManager(userAgent: string | undefined): PackageManager {
  const name = userAgent?.trim().split("/")[0]?.toLowerCase();
  return name && isPackageManager(name) ? name : DEFAULT_PACKAGE_MANAGER;
}

export function installCommand(packageManager: PackageManager): string {
  return `${packageManager} install`;
}

export function runScriptCommand(packageManager: PackageManager, script: string): string {
  return packageManager === "pnpm" || packageManager === "yarn"
    ? `${packageManager} ${script}`
    : `${packageManager} run ${script}`;
}

export function runInstall(packageManager: PackageManager, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child =
      process.platform === "win32"
        ? spawn(installCommand(packageManager), { cwd, stdio: "inherit", shell: true })
        : spawn(packageManager, ["install"], { cwd, stdio: "inherit" });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}
