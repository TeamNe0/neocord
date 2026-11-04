import { ActionRow, Bold, Button, Container, Subtext, TextDisplay, useLiveInteraction } from "@teamneo/neocord-react";
import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  const interaction = useLiveInteraction();

  return (
    <Container accentColor="green">
      <TextDisplay>
        Count: <Bold>{count}</Bold>
      </TextDisplay>
      <Subtext>Last clicked by {interaction?.user.username ?? "nobody yet"}</Subtext>
      <ActionRow>
        <Button label="-1" onClick={() => setCount(count - 1)} />
        <Button label="+1" style="primary" onClick={() => setCount(count + 1)} />
        <Button label="Reset" style="danger" disabled={count === 0} onClick={() => setCount(0)} />
      </ActionRow>
    </Container>
  );
}
