# {{projectName}}

A Discord bot built with neocord, discord.js and React.

## Getting started

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications) and copy its bot token.
2. Install dependencies with `{{install}}`.
3. Copy `.env.example` to `.env` and set `DISCORD_TOKEN`. Set `DEV_GUILD_ID` to a server you own so commands sync there immediately during development.
4. Start the bot with `{{dev}}`.

Try `/ping` and `/about` in your server.

## Commands

{{scripts}}

{{database}}## Project layout

- `neocord.config.ts` holds the bot configuration.
- `src/env.ts` validates environment variables with [T3 Env](https://env.t3.gg). Add new variables here.
- `src/error.tsx` is shown when a handler throws.
- `src/features/<feature>` groups related `commands`, `buttons`, `selects`, `modals`, `events` and `tasks`. The file path decides the route.
- Folders starting with `_`, such as `_components`, are private and never become routes.

## Production

Build and run directly with the `build` and `start` scripts, or use the included `Dockerfile`:

```sh
docker build -t {{imageName}} .
docker run --env-file .env {{imageName}}
```

Run the `deploy` script to register global slash commands when they change.
