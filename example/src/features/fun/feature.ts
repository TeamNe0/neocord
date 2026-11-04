import { defineFeature } from "neocord";
import { env } from "~/env";

export default defineFeature({
  enabled: env.ENABLE_FUN,
});
