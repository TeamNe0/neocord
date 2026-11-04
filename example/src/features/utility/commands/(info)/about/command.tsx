import { Bold, Container, Heading, Link, Subtext, TextDisplay } from "@teamneo/neocord-react";
import { defineCommand } from "neocord";
import { Suspense, use } from "react";
import { countCases } from "~/features/moderation/_lib/cases";

function CaseCount({ total }: { total: Promise<number> }) {
  return (
    <TextDisplay>
      Moderation cases on record: <Bold>{use(total)}</Bold>
    </TextDisplay>
  );
}

export default defineCommand({
  description: "What this bot is and what it remembers",
  execute(ctx) {
    return (
      <Container accentColor="blurple">
        <Heading level={3}>About {ctx.client.user.username}</Heading>
        <TextDisplay>
          The reference bot for <Link href="https://neocord.dev">neocord</Link>, a file-routed framework on discord.js and React.
        </TextDisplay>
        <Suspense fallback={<Subtext>Counting cases...</Subtext>}>
          <CaseCount total={countCases(ctx.app.db)} />
        </Suspense>
      </Container>
    );
  },
});
