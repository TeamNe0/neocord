import { Container, Heading, Subtext } from "@neocord/react";

export default function ErrorView() {
  return (
    <Container accentColor="#ed4245">
      <Heading>Something went wrong</Heading>
      <Subtext>The error was logged. Please try again in a moment.</Subtext>
    </Container>
  );
}
