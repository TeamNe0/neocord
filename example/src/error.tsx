import { Container, Heading, Subtext } from "@neocord/react";

export default function RootError() {
  return (
    <Container accentColor="red">
      <Heading level={3}>Something went wrong</Heading>
      <Subtext>The error was logged. Please try again in a moment.</Subtext>
    </Container>
  );
}
