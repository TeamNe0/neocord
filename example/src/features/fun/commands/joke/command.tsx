import { Quote, TextDisplay, escapeMarkdown } from "@teamneo/neocord-react";
import { defineCommand } from "neocord";
import { fetchJoke } from "../../_lib/jokes";

export default defineCommand({
  description: "Fetch a dad joke",
  async execute() {
    const joke = await fetchJoke();
    return (
      <TextDisplay>
        <Quote>{escapeMarkdown(joke)}</Quote>
      </TextDisplay>
    );
  },
});
