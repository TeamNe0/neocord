import { ActionRow, Bold, Button, Container, TextDisplay, escapeMarkdown } from "@teamneo/neocord-react";
import { pickAnswer, toRouteWords } from "../_lib/eight-ball";

export function EightBallAnswer({ question }: { question: string }) {
  return (
    <Container accentColor="black">
      <TextDisplay>
        You asked: {escapeMarkdown(question)}
      </TextDisplay>
      <TextDisplay>
        <Bold>{pickAnswer()}</Bold>
      </TextDisplay>
      <ActionRow>
        <Button route="fun/8ball/[...question]" params={{ question: toRouteWords(question) }} label="Ask again" />
      </ActionRow>
    </Container>
  );
}
