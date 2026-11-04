import { Container, TextDisplay } from "@teamneo/neocord-react";

export default function FunError() {
  return (
    <Container accentColor="yellow">
      <TextDisplay>That was not much fun. Something broke, so please try again.</TextDisplay>
    </Container>
  );
}
