import { Bold, Code, Container, Heading, List, ListItem, Subtext, TextDisplay } from "@neocord/react";
import { defineCommand, type CommandInfo } from "neocord";

function label(command: CommandInfo): string {
  return command.kind === "command" ? `/${command.name}` : command.name;
}

function summary(command: CommandInfo): string {
  if (command.kind === "user-command") return "Right-click a user";
  if (command.kind === "message-command") return "Right-click a message";
  return command.description ?? "";
}

export default defineCommand({
  description: "List the commands you can use",
  ephemeral: true,
  execute(ctx) {
    const { member } = ctx;
    const usable = ctx.commands.filter((command) =>
      member === null
        ? !command.guildOnly && command.permissions.length === 0
        : member.permissions.has([...command.permissions]),
    );
    const features = [...new Set(usable.map((command) => command.feature))].sort();

    return (
      <Container accentColor="blurple">
        <Heading level={3}>Commands</Heading>
        {features.map((feature) => (
          <TextDisplay key={feature}>
            <Bold>{feature}</Bold>
            <List>
              {usable
                .filter((command) => command.feature === feature)
                .map((command) => (
                  <ListItem key={`${command.kind}:${command.name}`}>
                    <Code>{label(command)}</Code> {summary(command)}
                  </ListItem>
                ))}
            </List>
          </TextDisplay>
        ))}
        <Subtext>Commands that need permissions you do not have are hidden.</Subtext>
      </Container>
    );
  },
});
