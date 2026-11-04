import { Message, TextDisplay } from "@neocord/react";
import { defineCommand, option } from "neocord";
import { QuizCard } from "../../_components/QuizCard";
import { findQuestion, matchTopics } from "../../_lib/quiz";

export default defineCommand({
  description: "Answer a quiz question",
  options: {
    topic: option.string({
      description: "What to be quizzed on",
      required: true,
      autocomplete: (ctx) => matchTopics(ctx.focused).map(({ label, topic }) => ({ name: label, value: topic })),
    }),
  },
  execute(ctx) {
    const quiz = findQuestion(ctx.options.topic);
    if (quiz === undefined) {
      return (
        <Message ephemeral>
          <TextDisplay>There is no quiz on that topic. Pick one from the list.</TextDisplay>
        </Message>
      );
    }
    return <QuizCard quiz={quiz} />;
  },
});
