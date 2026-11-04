import { Container, Heading, Subtext, TextDisplay } from "@teamneo/neocord-react";
import { defineCommand, option } from "neocord";

export default defineCommand({
  description: "Save a note, or read the one you saved",
  ephemeral: true,
  options: {
    note: option.string({ description: "What to remember", maxLength: 500 }),
  },
  async execute(ctx) {
    const { db } = ctx.app;
    const userId = ctx.user.id;
    const content = ctx.options.note;

    if (content) {
      await db.note.upsert({
        where: { userId },
        create: { userId, content },
        update: { content },
      });
    }

    const saved = await db.note.findUnique({ where: { userId } });

    return (
      <Container accentColor="#5865f2">
        <Heading>Your note</Heading>
        {saved ? (
          <TextDisplay>{saved.content}</TextDisplay>
        ) : (
          <Subtext>You have not saved a note yet. Use the note option to save one.</Subtext>
        )}
      </Container>
    );
  },
});
