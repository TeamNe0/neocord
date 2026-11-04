import { Container, Heading, Subtext, TextDisplay } from "@teamneo/neocord-react";
import { eq } from "drizzle-orm";
import { defineCommand, option } from "neocord";
import { notes } from "~/db/schema";

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
      await db
        .insert(notes)
        .values({ userId, content })
        .onDuplicateKeyUpdate({ set: { content, updatedAt: new Date() } });
    }

    const [saved] = await db.select().from(notes).where(eq(notes.userId, userId)).limit(1);

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
