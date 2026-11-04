import { ActionRow, Bold, Container, Heading, Option, StringSelect, TextDisplay } from "@teamneo/neocord-react";
import { useState } from "react";
import type { QuizQuestion } from "../_lib/quiz";

export function QuizCard({ quiz }: { quiz: QuizQuestion }) {
  const [answer, setAnswer] = useState<string | null>(null);

  return (
    <Container accentColor="blurple">
      <Heading level={3}>{quiz.label}</Heading>
      <TextDisplay>{quiz.question}</TextDisplay>
      {answer === null ? null : (
        <TextDisplay>
          {answer === quiz.correct ? "Correct!" : "Not quite."} The answer is <Bold>{quiz.correct}</Bold>.
        </TextDisplay>
      )}
      <ActionRow>
        <StringSelect
          placeholder="Pick an answer"
          disabled={answer !== null}
          onSelect={(event) => setAnswer(event.values[0] ?? null)}
        >
          {quiz.answers.map((value) => (
            <Option key={value} label={value} value={value} default={value === answer} />
          ))}
        </StringSelect>
      </ActionRow>
    </Container>
  );
}
