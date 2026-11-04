import { defineButton } from "neocord";
import { EightBallAnswer } from "../../../_components/EightBallAnswer";

export default defineButton("fun/8ball/[...question]", {
  cooldown: "2s",
  execute: (ctx) => <EightBallAnswer question={ctx.params.question.join(" ")} />,
});
