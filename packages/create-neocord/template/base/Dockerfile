FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --ignore-scripts
COPY . .
RUN SKIP_ENV_VALIDATION=true bun --bun run build

FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN chown bun:bun /app
COPY --chown=bun:bun --from=build /app ./
USER bun
CMD ["bun", "--bun", "run", "start"]
