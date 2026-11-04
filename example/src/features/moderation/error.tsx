import { Code, Container, Heading, Subtext, TextDisplay, escapeMarkdown } from "@neocord/react";
import type { ErrorProps } from "neocord";

export default function ModerationError({ error, ctx }: ErrorProps) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return (
    <Container accentColor="#ed4245">
      <Heading level={3}>That moderation action failed</Heading>
      <TextDisplay>
        <Code>{ctx.route}</Code> reported: {escapeMarkdown(message)}
      </TextDisplay>
      <Subtext>Check that the bot has the right permissions and that its role is above the target.</Subtext>
    </Container>
  );
}
