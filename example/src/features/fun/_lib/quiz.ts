export interface QuizQuestion {
  topic: string;
  label: string;
  question: string;
  answers: readonly string[];
  correct: string;
}

export const QUIZ_QUESTIONS: readonly QuizQuestion[] = [
  {
    topic: "space",
    label: "Space",
    question: "Which planet has the shortest day?",
    answers: ["Mercury", "Earth", "Jupiter"],
    correct: "Jupiter",
  },
  {
    topic: "animals",
    label: "Animals",
    question: "How many hearts does an octopus have?",
    answers: ["One", "Two", "Three"],
    correct: "Three",
  },
  {
    topic: "computers",
    label: "Computers",
    question: "How many bits are in a byte?",
    answers: ["4", "8", "16"],
    correct: "8",
  },
];

export function findQuestion(topic: string): QuizQuestion | undefined {
  return QUIZ_QUESTIONS.find((question) => question.topic === topic);
}

export function matchTopics(search: string): readonly QuizQuestion[] {
  const needle = search.trim().toLowerCase();
  return QUIZ_QUESTIONS.filter((question) => question.label.toLowerCase().includes(needle));
}
