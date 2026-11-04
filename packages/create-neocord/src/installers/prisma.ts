import type { Dialect } from "../options.ts";
import type { AvailableDependency } from "../versions.ts";
import {
  addDependencies,
  addDevDependencies,
  appendLines,
  copyTemplate,
  type Installer,
  replaceInFile,
  requireDialect,
} from "./shared.ts";

const ADAPTERS = {
  sqlite: "@prisma/adapter-libsql",
  postgres: "@prisma/adapter-pg",
  mysql: "@prisma/adapter-mariadb",
} as const satisfies Record<Dialect, AvailableDependency>;

const MYSQL_README =
  " MySQL 8 servers without TLS also need `?allowPublicKeyRetrieval=true` at the end of `DATABASE_URL`, because `@prisma/adapter-mariadb` connects through the MariaDB driver.";

export const prismaInstaller: Installer = async (context) => {
  const dialect = requireDialect(context);
  await copyTemplate(context, `extras/prisma-${dialect}`);

  addDependencies(context, ["@prisma/client", ADAPTERS[dialect]]);
  addDevDependencies(context, ["dotenv", "prisma"]);

  Object.assign(context.packageJson.scripts, {
    "db:push": "prisma db push",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:studio": "prisma studio",
    postinstall: "prisma generate",
  });

  await appendLines(context, "_gitignore", dialect === "sqlite" ? ["src/generated", "*.db", "*.db-*"] : ["src/generated"]);
  await replaceInFile(
    context,
    "Dockerfile",
    "RUN SKIP_ENV_VALIDATION=true bun --bun run build",
    "RUN bun run db:generate\nRUN SKIP_ENV_VALIDATION=true bun --bun run build",
  );

  const note = dialect === "mysql" ? MYSQL_README : "";
  context.databaseReadme = `This project uses [Prisma](https://www.prisma.io/docs). The schema is in \`prisma/schema.prisma\`, and the client is generated into \`src/generated/prisma\` on install.${note}`;
};
