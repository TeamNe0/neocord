import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initGit } from "./git.ts";
import type { Database, Dialect, ProjectOptions } from "./options.ts";
import { scaffold } from "./scaffold.ts";
import { dependencyVersionMap, VERSION_OVERRIDES_ENV } from "./versions.ts";

interface GeneratedManifest {
  name: string;
  private: boolean;
  type: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

let root: string;
let counter = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "create-neocord-test-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function nextDir(): string {
  counter += 1;
  return join(root, `project-${counter}`);
}

function optionsFor(overrides: Partial<ProjectOptions> = {}): ProjectOptions {
  return {
    projectName: "test-bot",
    targetDir: nextDir(),
    database: "none",
    dialect: null,
    eslint: true,
    packageManager: "bun",
    git: false,
    install: false,
    overwrite: false,
    ...overrides,
  };
}

function listFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${prefix}${entry.name}`;
    return entry.isDirectory() ? listFiles(join(directory, entry.name), `${relativePath}/`) : [relativePath];
  });
}

function readManifest(directory: string): GeneratedManifest {
  return JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as GeneratedManifest;
}

const BASE_FILES = [
  ".dockerignore",
  ".env.example",
  ".gitignore",
  "Dockerfile",
  "README.md",
  "neocord.config.ts",
  "package.json",
  "tsconfig.json",
  "src/env.ts",
  "src/error.tsx",
  "src/features/general/_components/Stat.tsx",
  "src/features/general/buttons/refresh/button.tsx",
  "src/features/general/commands/about/command.tsx",
  "src/features/general/commands/ping/command.test.tsx",
  "src/features/general/commands/ping/command.tsx",
  "src/features/general/events/clientReady.ts",
];

const DRIVER_BY_COMBINATION: Record<string, readonly string[]> = {
  "drizzle-sqlite": ["drizzle-orm", "@libsql/client"],
  "drizzle-postgres": ["drizzle-orm", "postgres"],
  "drizzle-mysql": ["drizzle-orm", "mysql2"],
  "prisma-sqlite": ["@prisma/client", "@prisma/adapter-libsql"],
  "prisma-postgres": ["@prisma/client", "@prisma/adapter-pg"],
  "prisma-mysql": ["@prisma/client", "@prisma/adapter-mariadb"],
};

const COMBINATIONS: { database: Database; dialect: Dialect | null }[] = [
  { database: "none", dialect: null },
  { database: "drizzle", dialect: "sqlite" },
  { database: "drizzle", dialect: "postgres" },
  { database: "drizzle", dialect: "mysql" },
  { database: "prisma", dialect: "sqlite" },
  { database: "prisma", dialect: "postgres" },
  { database: "prisma", dialect: "mysql" },
];

for (const { database, dialect } of COMBINATIONS) {
  for (const eslint of [true, false]) {
    const label = `${database}${dialect ? `-${dialect}` : ""}, eslint ${eslint ? "on" : "off"}`;

    describe(label, () => {
      let directory: string;
      let manifest: GeneratedManifest;
      let files: string[];

      beforeAll(async () => {
        const options = optionsFor({ database, dialect, eslint });
        directory = options.targetDir;
        const result = await scaffold(options);
        expect(result.install).toBe("skipped");
        expect(result.git).toEqual({ status: "skipped" });
        manifest = readManifest(directory);
        files = listFiles(directory);
      });

      test("creates the base files without leftovers", () => {
        for (const file of BASE_FILES) expect(files).toContain(file);
        expect(files).not.toContain("_gitignore");
        expect(existsSync(join(directory, ".git"))).toBe(false);
        expect(existsSync(join(directory, "node_modules"))).toBe(false);
      });

      test("has no unresolved placeholders", () => {
        for (const file of files) {
          expect({ file, placeholder: /\{\{\w+\}\}/.test(readFileSync(join(directory, file), "utf8")) }).toEqual({
            file,
            placeholder: false,
          });
        }
      });

      test("writes valid JSON files", () => {
        for (const file of files.filter((name) => name.endsWith(".json"))) {
          expect(() => JSON.parse(readFileSync(join(directory, file), "utf8"))).not.toThrow();
        }
      });

      test("writes the manifest basics", () => {
        expect(manifest.name).toBe("test-bot");
        expect(manifest.private).toBe(true);
        expect(manifest.type).toBe("module");
        expect(manifest.scripts).toMatchObject({
          dev: "neocord dev",
          build: "neocord build",
          start: "neocord start",
          deploy: "neocord deploy",
          test: "neocord test",
          typecheck: "neocord typegen && tsc --noEmit",
        });
        for (const name of ["discord.js", "neocord", "@neocord/react", "react", "@t3-oss/env-core", "zod"] as const) {
          expect(manifest.dependencies[name]).toBe(dependencyVersionMap[name]);
        }
        for (const name of ["@neocord/cli", "@types/react", "@types/node", "@types/bun"] as const) {
          expect(manifest.devDependencies[name]).toBe(dependencyVersionMap[name]);
        }
      });

      test("applies the ESLint choice", () => {
        expect(files.includes("eslint.config.js")).toBe(eslint);
        if (eslint) {
          expect(manifest.scripts.lint).toBe("neocord lint");
          expect(manifest.devDependencies).toMatchObject({
            "@typescript/native": "npm:typescript@^7.0.2",
            typescript: "npm:@typescript/typescript6@^6.0.2",
            eslint: dependencyVersionMap.eslint,
            "@neocord/eslint-plugin": dependencyVersionMap["@neocord/eslint-plugin"],
            "@typescript-eslint/parser": dependencyVersionMap["@typescript-eslint/parser"],
          });
        } else {
          expect(manifest.scripts.lint).toBeUndefined();
          expect(manifest.devDependencies.typescript).toBe("npm:typescript@^7.0.2");
          expect(manifest.devDependencies["@typescript/native"]).toBeUndefined();
          expect(manifest.devDependencies.eslint).toBeUndefined();
          expect(manifest.devDependencies["@neocord/eslint-plugin"]).toBeUndefined();
        }
      });

      test("wires the database choice", () => {
        const env = readFileSync(join(directory, "src/env.ts"), "utf8");
        const envExample = readFileSync(join(directory, ".env.example"), "utf8");
        const gitignore = readFileSync(join(directory, ".gitignore"), "utf8");
        const remember = "src/features/general/commands/remember/command.tsx";

        expect(env).toContain("DISCORD_TOKEN: z.string().min(1)");
        expect(env).toContain("DEV_GUILD_ID: z.string().min(1).optional()");
        expect(env).toContain("NODE_ENV: z.enum");
        expect(env).toContain("runtimeEnv: process.env");
        expect(env).toContain("emptyStringAsUndefined: true");
        expect(envExample).toContain("DISCORD_TOKEN=");

        if (database === "none") {
          expect(env).not.toContain("DATABASE_URL");
          expect(envExample).not.toContain("DATABASE_URL");
          expect(files).not.toContain("src/context.ts");
          expect(files).not.toContain(remember);
          expect(manifest.scripts["db:push"]).toBeUndefined();
          expect(manifest.dependencies).not.toHaveProperty("drizzle-orm");
          expect(manifest.dependencies).not.toHaveProperty("@prisma/client");
          return;
        }

        expect(env).toContain(dialect === "sqlite" ? "DATABASE_URL: z.string().min(1)" : "DATABASE_URL: z.url()");
        expect(envExample).toContain("DATABASE_URL=");
        expect(files).toContain("src/context.ts");
        expect(files).toContain("src/db/index.ts");
        expect(files).toContain(remember);
        expect(readFileSync(join(directory, "src/context.ts"), "utf8")).toContain("defineContext");
        expect(readFileSync(join(directory, remember), "utf8")).toContain("ctx.app");
        expect(readFileSync(join(directory, "README.md"), "utf8")).toContain("db:push");

        for (const script of ["db:push", "db:generate", "db:migrate", "db:studio"]) {
          expect(manifest.scripts[script]).toBeDefined();
        }
        for (const name of DRIVER_BY_COMBINATION[`${database}-${dialect}`] ?? []) {
          expect(manifest.dependencies).toHaveProperty(name);
        }
        expect(manifest.devDependencies).toHaveProperty("dotenv");

        if (dialect === "sqlite") expect(gitignore).toContain("*.db");

        if (database === "drizzle") {
          expect(files).toContain("drizzle.config.ts");
          expect(files).toContain("src/db/schema.ts");
          expect(files).not.toContain("prisma/schema.prisma");
          expect(manifest.scripts["db:push"]).toBe("drizzle-kit push");
          expect(manifest.scripts.postinstall).toBeUndefined();
          expect(manifest.devDependencies["drizzle-kit"]).toBe(dependencyVersionMap["drizzle-kit"]);
        } else {
          expect(files).toContain("prisma/schema.prisma");
          expect(files).toContain("prisma.config.ts");
          expect(files).not.toContain("drizzle.config.ts");
          expect(manifest.scripts.postinstall).toBe("prisma generate");
          expect(manifest.scripts["db:push"]).toBe("prisma db push");
          expect(manifest.devDependencies.prisma).toBe("^7.10.1");
          expect(manifest.dependencies["@prisma/client"]).toBe("^7.10.1");
          expect(gitignore).toContain("src/generated");
          expect(readFileSync(join(directory, "Dockerfile"), "utf8")).toContain("RUN bun run db:generate");
          const schema = readFileSync(join(directory, "prisma/schema.prisma"), "utf8");
          expect(schema).toContain('provider = "prisma-client"');
          expect(schema).toContain('output   = "../src/generated/prisma"');
          expect(schema).not.toContain("env(");
        }
      });
    });
  }
}

describe("scaffold behaviour", () => {
  test("adds @types/bun only for bun", async () => {
    for (const packageManager of ["npm", "pnpm", "yarn"] as const) {
      const options = optionsFor({ packageManager });
      await scaffold(options);
      expect(readManifest(options.targetDir).devDependencies).not.toHaveProperty("@types/bun");
      const tsconfig = JSON.parse(readFileSync(join(options.targetDir, "tsconfig.json"), "utf8"));
      expect(tsconfig.compilerOptions.types).toEqual(["node"]);
    }
  });

  test("uses the package manager in the README", async () => {
    const options = optionsFor({ packageManager: "pnpm", database: "drizzle", dialect: "sqlite" });
    await scaffold(options);
    const readme = readFileSync(join(options.targetDir, "README.md"), "utf8");
    expect(readme).toContain("# test-bot");
    expect(readme).toContain("`pnpm install`");
    expect(readme).toContain("`pnpm dev`");
    expect(readme).toContain("`pnpm db:push`");
  });

  test("keeps a scoped name in the manifest and a valid image name in the README", async () => {
    const options = optionsFor({ projectName: "@acme/bot" });
    await scaffold(options);
    expect(readManifest(options.targetDir).name).toBe("@acme/bot");
    const readme = readFileSync(join(options.targetDir, "README.md"), "utf8");
    expect(readme).toContain("# @acme/bot");
    expect(readme).toContain("docker build -t acme/bot .");
  });

  test("applies version overrides", async () => {
    const options = optionsFor();
    await scaffold(options, { env: { [VERSION_OVERRIDES_ENV]: '{"neocord":"file:/tmp/neocord.tgz"}' } });
    const manifest = readManifest(options.targetDir);
    expect(manifest.dependencies.neocord).toBe("file:/tmp/neocord.tgz");
    expect(manifest.dependencies.react).toBe(dependencyVersionMap.react);
  });

  test("ignores overrides when they are not set", async () => {
    const options = optionsFor();
    await scaffold(options, { env: {} });
    expect(readManifest(options.targetDir).dependencies.neocord).toBe(dependencyVersionMap.neocord);
  });

  test("refuses a non-empty directory without overwrite", async () => {
    const options = optionsFor();
    mkdirSync(options.targetDir, { recursive: true });
    writeFileSync(join(options.targetDir, "keep.txt"), "keep");
    await expect(scaffold(options)).rejects.toThrow("is not empty");
    expect(listFiles(options.targetDir)).toEqual(["keep.txt"]);
  });

  test("merges into a non-empty directory with overwrite", async () => {
    const options = optionsFor({ overwrite: true });
    mkdirSync(options.targetDir, { recursive: true });
    writeFileSync(join(options.targetDir, "keep.txt"), "keep");
    writeFileSync(join(options.targetDir, ".gitignore"), "old");
    await scaffold(options);
    expect(readFileSync(join(options.targetDir, "keep.txt"), "utf8")).toBe("keep");
    expect(readFileSync(join(options.targetDir, ".gitignore"), "utf8")).toContain("node_modules");
    expect(existsSync(join(options.targetDir, "_gitignore"))).toBe(false);
  });

  test("treats a directory holding only .git as empty", async () => {
    const options = optionsFor();
    mkdirSync(join(options.targetDir, ".git"), { recursive: true });
    await expect(scaffold(options)).resolves.toBeDefined();
  });

  test("refuses a path that is a file", async () => {
    const options = optionsFor();
    writeFileSync(options.targetDir, "file");
    await expect(scaffold(options)).rejects.toThrow("not a directory");
  });

  test("rejects invalid options", async () => {
    await expect(scaffold(optionsFor({ projectName: "Bad Name" }))).rejects.toThrow("lowercase");
    await expect(scaffold(optionsFor({ database: "drizzle" }))).rejects.toThrow("needs a dialect");
    await expect(scaffold(optionsFor({ dialect: "mysql" }))).rejects.toThrow("with a database");
  });

  test("copies the exact ESLint config", async () => {
    const options = optionsFor();
    await scaffold(options);
    expect(readFileSync(join(options.targetDir, "eslint.config.js"), "utf8")).toBe(
      [
        'import neocord from "@neocord/eslint-plugin";',
        'import tsParser from "@typescript-eslint/parser";',
        "export default [",
        '  { ignores: [".neocord/**", "dist/**"] },',
        '  { files: ["**/*.{ts,tsx}"], languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } } },',
        "  neocord.configs.recommended,",
        "];",
        "",
      ].join("\n"),
    );
  });

  test("writes the TypeScript options", async () => {
    const options = optionsFor();
    await scaffold(options);
    const tsconfig = JSON.parse(readFileSync(join(options.targetDir, "tsconfig.json"), "utf8"));
    expect(tsconfig.include).toEqual(["src", "neocord.config.ts", ".neocord/types.d.ts"]);
    expect(tsconfig.compilerOptions).toMatchObject({
      strict: true,
      noUncheckedIndexedAccess: true,
      jsx: "react-jsx",
      moduleResolution: "Bundler",
      module: "ESNext",
      target: "ES2023",
      lib: ["ES2023"],
      verbatimModuleSyntax: true,
      noEmit: true,
      skipLibCheck: true,
      types: ["node", "bun"],
      paths: { "~/*": ["./src/*"] },
    });
  });
});

describe("git", () => {
  test("initializes a repository in a new project", async () => {
    const options = optionsFor();
    await scaffold(options);
    const result = await initGit(options.targetDir);
    expect(result.status).toBe("initialized");
    expect(existsSync(join(options.targetDir, ".git"))).toBe(true);
  });

  test("does not nest inside an existing repository", async () => {
    const options = optionsFor();
    await scaffold(options);
    await initGit(options.targetDir);
    const nested = join(options.targetDir, "nested");
    mkdirSync(nested);
    expect(await initGit(nested)).toEqual({ status: "existing-repository" });
    expect(existsSync(join(nested, ".git"))).toBe(false);
  });
});
