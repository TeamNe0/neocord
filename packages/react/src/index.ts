import { escapeMarkdown as escapeDiscordMarkdown } from "discord.js";

export { buildCustomId, type RouteParams } from "@teamneo/neocord-routing";
export { createLiveRoot, useLiveInteraction } from "./live.ts";
export { render, renderAsync, renderModal } from "./render.ts";
export type * from "./types.ts";
export * from "./components/inline.tsx";
export * from "./components/interactive.tsx";
export * from "./components/layout.tsx";
export * from "./components/modal.tsx";

export function escapeMarkdown(text: string): string {
  return escapeDiscordMarkdown(text, {
    heading: true,
    bulletedList: true,
    numberedList: true,
    maskedLink: true,
  })
    .replace(/^(\s*)>/gm, "$1\\>")
    .replace(/^(\s*)-#/gm, "$1\\-#");
}
