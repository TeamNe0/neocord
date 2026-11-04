import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DISCORD_TOKEN: z.string().min(1),
    DEV_GUILD_ID: z.string().min(1).optional(),
    DATABASE_URL: z.string().min(1).default("file:./example.db"),
    ENABLE_FUN: z.stringbool().default(true),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
});
