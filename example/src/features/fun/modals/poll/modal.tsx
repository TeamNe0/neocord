import { Label, TextInput } from "@teamneo/neocord-react";
import { defineModal } from "neocord";
import { z } from "zod";
import { Poll } from "../../_components/Poll";

const Choices = z
  .string()
  .transform((value) => [...new Set(value.split("\n").map((line) => line.trim()).filter(Boolean))])
  .pipe(
    z
      .array(z.string().max(80, "Keep each choice under 80 characters."))
      .min(2, "Add at least 2 different choices, one per line.")
      .max(4, "A poll can have at most 4 choices."),
  );

export default defineModal("fun/poll", {
  title: "New poll",
  schema: z.object({
    question: z.string().trim().min(3, "Ask a question of at least 3 characters.").max(200),
    choices: Choices,
  }),
  render: ({ field }) => (
    <>
      <Label label="Question">
        <TextInput customId={field("question")} maxLength={200} placeholder="Pizza or tacos?" />
      </Label>
      <Label label="Choices" description="One per line, between 2 and 4">
        <TextInput customId={field("choices")} style="paragraph" placeholder={"Pizza\nTacos"} />
      </Label>
    </>
  ),
  submit: (ctx) => <Poll question={ctx.values.question} choices={ctx.values.choices} />,
});
