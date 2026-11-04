import { defineCommand, option } from "neocord";
import { EightBallAnswer } from "../../_components/EightBallAnswer";

export default defineCommand({
  description: "Ask the magic 8 ball a question",
  options: {
    question: option.string({ description: "What do you want to know?", required: true, maxLength: 200 }),
  },
  execute: (ctx) => <EightBallAnswer question={ctx.options.question} />,
});
