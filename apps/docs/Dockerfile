FROM oven/bun:1 AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts
ARG VITE_SITE_URL=https://neocord.dev
ENV VITE_SITE_URL=$VITE_SITE_URL
WORKDIR /repo/apps/docs
RUN bun run build

FROM nginx:1-alpine AS runtime
COPY apps/docs/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/docs/dist /usr/share/nginx/html
EXPOSE 8080
