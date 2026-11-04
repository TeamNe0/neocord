import { randomInt } from "node:crypto";

const ANSWERS = ["It is certain.", "Ask again later.", "Signs point to yes.", "Very doubtful.", "Without a doubt."] as const;
const ROUTE_PREFIX_LENGTH = "fun/8ball/".length;
const CUSTOM_ID_LIMIT = 100;

export function pickAnswer(): string {
  return ANSWERS[randomInt(ANSWERS.length)] ?? ANSWERS[0];
}

export function toRouteWords(question: string): string[] {
  const words: string[] = [];
  let length = ROUTE_PREFIX_LENGTH;
  for (const word of question.split(/\s+/).filter(Boolean)) {
    const encoded = encodeURIComponent(word).length + 1;
    if (length + encoded > CUSTOM_ID_LIMIT) break;
    words.push(word);
    length += encoded;
  }
  return words.length === 0 ? ["?"] : words;
}
