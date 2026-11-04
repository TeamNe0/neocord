import { Container, Subtext, TextDisplay } from "@neocord/react";
import type { ErrorProps } from "neocord";

export default function UtilityError({ ctx }: ErrorProps) {
  return (
    <Container accentColor="yellow">
      <TextDisplay>Could not finish {ctx.route}.</TextDisplay>
      <Subtext>This one is on us. The error was logged.</Subtext>
    </Container>
  );
}
