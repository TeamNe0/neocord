import { Bold, Container, Heading, TextDisplay } from "@neocord/react";
import { defineCommand, option } from "neocord";
import { randomInt } from "node:crypto";

const DIE_NAMES: Record<4 | 6 | 20, string> = {
  4: "caltrop",
  6: "classic cube",
  20: "icosahedron",
};

export default defineCommand({
  description: "Roll some dice",
  options: {
    sides: option.integer({
      description: "Which die to roll",
      required: true,
      choices: [
        { name: "d4", value: 4 },
        { name: "d6", value: 6 },
        { name: "d20", value: 20 },
      ],
    }),
    count: option.integer({ description: "How many dice to roll", minValue: 1, maxValue: 10 }),
  },
  execute(ctx) {
    const { sides, count = 1 } = ctx.options;
    const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1));
    const total = rolls.reduce((sum, roll) => sum + roll, 0);
    return (
      <Container accentColor="blurple">
        <Heading level={3}>
          {count} x {DIE_NAMES[sides]}
        </Heading>
        <TextDisplay>
          {rolls.join(", ")} for a total of <Bold>{total}</Bold>
        </TextDisplay>
      </Container>
    );
  },
});
