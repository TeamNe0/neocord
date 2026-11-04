export const CLIENT_EVENT_NAMES = [
  "applicationCommandPermissionsUpdate",
  "autoModerationActionExecution",
  "autoModerationRuleCreate",
  "autoModerationRuleDelete",
  "autoModerationRuleUpdate",
  "cacheSweep",
  "channelCreate",
  "channelDelete",
  "channelPinsUpdate",
  "channelUpdate",
  "clientReady",
  "debug",
  "warn",
  "emojiCreate",
  "emojiDelete",
  "emojiUpdate",
  "entitlementCreate",
  "entitlementDelete",
  "entitlementUpdate",
  "error",
  "guildAuditLogEntryCreate",
  "guildAvailable",
  "guildBanAdd",
  "guildBanRemove",
  "guildCreate",
  "guildDelete",
  "guildUnavailable",
  "guildIntegrationsUpdate",
  "guildMemberAdd",
  "guildMemberAvailable",
  "guildMemberRemove",
  "guildMembersChunk",
  "guildMemberUpdate",
  "guildUpdate",
  "guildSoundboardSoundCreate",
  "guildSoundboardSoundDelete",
  "guildSoundboardSoundUpdate",
  "guildSoundboardSoundsUpdate",
  "inviteCreate",
  "inviteDelete",
  "messageCreate",
  "messageDelete",
  "messagePollVoteAdd",
  "messagePollVoteRemove",
  "messageReactionRemoveAll",
  "messageReactionRemoveEmoji",
  "messageDeleteBulk",
  "messageReactionAdd",
  "messageReactionRemove",
  "messageUpdate",
  "presenceUpdate",
  "ready",
  "invalidated",
  "roleCreate",
  "roleDelete",
  "roleUpdate",
  "threadCreate",
  "threadDelete",
  "threadListSync",
  "threadMemberUpdate",
  "threadMembersUpdate",
  "threadUpdate",
  "typingStart",
  "userUpdate",
  "voiceChannelEffectSend",
  "voiceServerUpdate",
  "voiceStateUpdate",
  "webhookUpdate",
  "webhooksUpdate",
  "interactionCreate",
  "shardDisconnect",
  "shardError",
  "shardReady",
  "shardReconnecting",
  "shardResume",
  "stageInstanceCreate",
  "stageInstanceUpdate",
  "stageInstanceDelete",
  "stickerCreate",
  "stickerDelete",
  "stickerUpdate",
  "subscriptionCreate",
  "subscriptionDelete",
  "subscriptionUpdate",
  "guildScheduledEventCreate",
  "guildScheduledEventUpdate",
  "guildScheduledEventDelete",
  "guildScheduledEventUserAdd",
  "guildScheduledEventUserRemove",
  "soundboardSounds",
] as const;

const CLIENT_EVENTS: ReadonlySet<string> = new Set(CLIENT_EVENT_NAMES);

export function isClientEvent(name: string): boolean {
  return CLIENT_EVENTS.has(name);
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row++) {
    const current = [row];
    for (let column = 1; column <= b.length; column++) {
      const substitution = (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1);
      current.push(Math.min((previous[column] ?? 0) + 1, (current[column - 1] ?? 0) + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

export function closestClientEvent(name: string): string {
  const target = name.toLowerCase();
  let best: string = CLIENT_EVENT_NAMES[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of CLIENT_EVENT_NAMES) {
    const distance = editDistance(target, candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
