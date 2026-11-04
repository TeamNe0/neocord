import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  catalogVersions,
  databaseVersions,
  dependencyVersionMap,
  frameworkVersions,
  parseVersionOverrides,
  resolveVersion,
  VERSION_OVERRIDES_ENV,
} from "./versions.ts";

interface RootManifest {
  workspaces: { catalog: Record<string, string> };
}

interface WorkspaceManifest {
  version: string;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as T;
}

describe("dependency versions", () => {
  test("shared versions match the root catalog", () => {
    const { catalog } = readJson<RootManifest>("../../../package.json").workspaces;
    for (const [name, version] of Object.entries(catalogVersions)) {
      expect({ name, version }).toEqual({ name, version: catalog[name] as typeof version });
    }
  });

  test("framework versions track the workspace packages", () => {
    const directories = {
      "@neocord/cli": "cli",
      "@neocord/eslint-plugin": "eslint-plugin",
      "@neocord/react": "react",
      neocord: "neocord",
    } as const;
    for (const [name, directory] of Object.entries(directories)) {
      const { version } = readJson<WorkspaceManifest>(`../../${directory}/package.json`);
      expect({ name, spec: frameworkVersions[name as keyof typeof frameworkVersions] as string }).toEqual({
        name,
        spec: `^${version}`,
      });
    }
  });

  test("prisma packages stay on the same stable major", () => {
    const prismaVersions = [
      databaseVersions.prisma,
      databaseVersions["@prisma/client"],
      databaseVersions["@prisma/adapter-libsql"],
      databaseVersions["@prisma/adapter-mariadb"],
      databaseVersions["@prisma/adapter-pg"],
    ];
    expect(new Set(prismaVersions)).toEqual(new Set(["^7.10.1"]));
  });
});

describe("version overrides", () => {
  test("are empty when the variable is not set", () => {
    expect(parseVersionOverrides({})).toEqual({});
    expect(resolveVersion("neocord", {})).toBe(dependencyVersionMap.neocord);
  });

  test("replace the matching dependency only", () => {
    const overrides = parseVersionOverrides({ [VERSION_OVERRIDES_ENV]: '{"neocord":"file:/tmp/neocord.tgz"}' });
    expect(resolveVersion("neocord", overrides)).toBe("file:/tmp/neocord.tgz");
    expect(resolveVersion("react", overrides)).toBe(dependencyVersionMap.react);
  });

  test("reject malformed values", () => {
    expect(() => parseVersionOverrides({ [VERSION_OVERRIDES_ENV]: "{nope" })).toThrow("valid JSON");
    expect(() => parseVersionOverrides({ [VERSION_OVERRIDES_ENV]: "[]" })).toThrow("JSON object");
    expect(() => parseVersionOverrides({ [VERSION_OVERRIDES_ENV]: '{"neocord":1}' })).toThrow("non-string");
  });
});
