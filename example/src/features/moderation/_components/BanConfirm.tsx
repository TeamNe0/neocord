import { ActionRow, Bold, Button, Heading, TextDisplay, UserMention } from "@teamneo/neocord-react";
import type { User } from "discord.js";

export function BanConfirm({ user }: { user: User }) {
  return (
    <>
      <Heading level={3}>Ban {user.username}?</Heading>
      <TextDisplay>
        This bans <UserMention id={user.id} /> from the server. <Bold>Confirm</Bold> asks you for a reason first.
      </TextDisplay>
      <ActionRow>
        <Button route="moderation/ban/confirm/[userId]" params={{ userId: user.id }} style="danger" label="Confirm" />
        <Button route="moderation/ban/cancel" style="secondary" label="Cancel" />
      </ActionRow>
    </>
  );
}
