import { ActionRow, Bold, Button, Container, Heading, List, ListItem, Message, TextDisplay, escapeMarkdown, render } from "@neocord/react";
import { useContext } from "neocord";
import { useState } from "react";

export function Poll({ question, choices }: { question: string; choices: readonly string[] }) {
  const { user: author } = useContext();
  const [votes, setVotes] = useState<Readonly<Record<string, number>>>({});
  const [closed, setClosed] = useState(false);

  const tally = choices.map((_, index) => Object.values(votes).filter((vote) => vote === index).length);

  return (
    <Container accentColor={closed ? "white" : "fuchsia"}>
      <Heading level={3}>{escapeMarkdown(question)}</Heading>
      <TextDisplay>
        <List>
          {choices.map((choice, index) => (
            <ListItem key={choice}>
              {escapeMarkdown(choice)}: <Bold>{tally[index]}</Bold>
            </ListItem>
          ))}
        </List>
      </TextDisplay>
      <ActionRow>
        {choices.map((choice, index) => (
          <Button
            key={choice}
            label={choice}
            style="primary"
            disabled={closed}
            onClick={(event) => setVotes((current) => ({ ...current, [event.user.id]: index }))}
          />
        ))}
      </ActionRow>
      <ActionRow>
        <Button
          label={closed ? "Closed" : "Close poll"}
          style="danger"
          disabled={closed}
          onClick={async (event) => {
            if (event.user.id !== author.id) {
              await event.reply(
                render(
                  <Message ephemeral>
                    <TextDisplay>Only the person who made this poll can close it.</TextDisplay>
                  </Message>,
                ),
              );
              return;
            }
            setClosed(true);
          }}
        />
      </ActionRow>
    </Container>
  );
}
