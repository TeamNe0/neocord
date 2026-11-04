import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { classifyFile } from "../../routing/src/conventions.ts";
import { TEMPLATE_DIR } from "./scaffold.ts";

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

const TEMPLATE_ROOTS = [
  "base",
  "extras/eslint",
  "extras/drizzle-sqlite",
  "extras/drizzle-postgres",
  "extras/drizzle-mysql",
  "extras/prisma-sqlite",
  "extras/prisma-postgres",
  "extras/prisma-mysql",
];

const templateFiles = TEMPLATE_ROOTS.flatMap((root) => {
  const directory = join(TEMPLATE_DIR, root);
  return listFiles(directory).map((path) => ({
    root,
    path,
    relativePath: relative(directory, path).replaceAll("\\", "/"),
  }));
});

const SOURCE_CHECKS = {
  "src/features/general/commands/ping/command.tsx": { type: "route", kind: "command", routeId: "ping" },
  "src/features/general/commands/about/command.tsx": { type: "route", kind: "command", routeId: "about" },
  "src/features/general/buttons/refresh/button.tsx": { type: "route", kind: "button", routeId: "general/refresh" },
  "src/features/general/events/clientReady.ts": { type: "route", kind: "event", routeId: "clientReady" },
} as const;

describe("template files", () => {
  test("every template root has files", () => {
    for (const root of TEMPLATE_ROOTS) {
      expect(templateFiles.some((file) => file.root === root)).toBe(true);
    }
  });

  test("every path under src/features is valid for classifyFile", () => {
    const features = templateFiles.filter((file) => file.relativePath.startsWith("src/features/"));
    expect(features.length).toBeGreaterThan(5);
    for (const { root, relativePath } of features) {
      const classification = classifyFile(relativePath);
      const label = `${root}/${relativePath}`;
      expect({ label, invalid: classification.type === "invalid" }).toEqual({ label, invalid: false });
      if (!relativePath.includes(".test.")) {
        expect({ label, outside: classification.type === "outside" }).toEqual({ label, outside: false });
      }
    }
  });

  test("starter routes resolve to the expected ids", () => {
    for (const [path, expected] of Object.entries(SOURCE_CHECKS)) {
      expect(classifyFile(path)).toMatchObject(expected);
    }
    for (const orm of ["drizzle", "prisma"]) {
      for (const dialect of ["sqlite", "postgres", "mysql"]) {
        const file = templateFiles.find(
          ({ root, relativePath }) =>
            root === `extras/${orm}-${dialect}` && relativePath === "src/features/general/commands/remember/command.tsx",
        );
        expect(file).toBeDefined();
      }
    }
    expect(classifyFile("src/features/general/commands/remember/command.tsx")).toMatchObject({ routeId: "remember" });
    expect(classifyFile("src/env.ts")).toEqual({ type: "env" });
    expect(classifyFile("src/context.ts")).toEqual({ type: "context" });
    expect(classifyFile("src/error.tsx")).toMatchObject({ type: "segment", kind: "error" });
  });

  test("the button route id matches its path", () => {
    const button = readFileSync(join(TEMPLATE_DIR, "base/src/features/general/buttons/refresh/button.tsx"), "utf8");
    expect(button).toContain('defineButton("general/refresh"');
  });

  test("nothing contains comments", () => {
    const commentPattern = /(^|\s)(\/\/\s|\/\*|\{\/\*)|^\s*#/m;
    const commented = templateFiles
      .filter(({ relativePath }) => !relativePath.endsWith(".md"))
      .filter(({ path }) => commentPattern.test(readFileSync(path, "utf8")))
      .map(({ root, relativePath }) => `${root}/${relativePath}`);
    expect(commented).toEqual([]);
  });

  test("nothing uses any", () => {
    const typed = templateFiles.filter(({ relativePath }) => /\.tsx?$/.test(relativePath));
    for (const { path } of typed) {
      expect(readFileSync(path, "utf8")).not.toMatch(/\bas any\b|:\s*any\b|<any>/);
    }
  });
});
