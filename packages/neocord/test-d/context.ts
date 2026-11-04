import { defineContext } from "neocord";

export default defineContext(async () => ({
  value: { db: { close: (): void => undefined } },
  dispose: () => undefined,
}));
