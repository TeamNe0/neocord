import type { Dialect } from "../options.ts";
import type { AvailableDependency } from "../versions.ts";
import { addDependencies, addDevDependencies, appendLines, copyTemplate, type Installer, requireDialect } from "./shared.ts";

const DRIVERS = {
  sqlite: "@libsql/client",
  postgres: "postgres",
  mysql: "mysql2",
} as const satisfies Record<Dialect, AvailableDependency>;

export const drizzleInstaller: Installer = async (context) => {
  const dialect = requireDialect(context);
  await copyTemplate(context, `extras/drizzle-${dialect}`);

  addDependencies(context, ["drizzle-orm", DRIVERS[dialect]]);
  addDevDependencies(context, ["dotenv", "drizzle-kit"]);

  Object.assign(context.packageJson.scripts, {
    "db:push": "drizzle-kit push",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
  });

  if (dialect === "sqlite") {
    await appendLines(context, "_gitignore", ["*.db", "*.db-*"]);
  }

  context.databaseReadme = "This project uses [Drizzle ORM](https://orm.drizzle.team). The schema is in `src/db/schema.ts`.";
};
