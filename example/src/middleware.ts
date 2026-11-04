import { defineMiddleware } from "neocord";

export default defineMiddleware(async (ctx, next) => {
  const startedAt = performance.now();
  await next();
  const elapsed = Math.round(performance.now() - startedAt);
  const role = ctx.state.moderator === true ? "moderator " : "";
  ctx.logger.info(`${ctx.kind} ${ctx.route} for ${role}${ctx.user.id} took ${elapsed}ms`);
});
