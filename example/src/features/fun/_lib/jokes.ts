import { z } from "zod";

const JOKE_URL = "https://icanhazdadjoke.com/";
const FALLBACK_JOKE = "I would tell you a joke about the network, but it timed out.";
const JokeResponse = z.object({ joke: z.string().min(1) });

export async function fetchJoke(): Promise<string> {
  try {
    const response = await fetch(JOKE_URL, {
      headers: { accept: "application/json", "user-agent": "neocord-example" },
      signal: AbortSignal.timeout(5000),
    });
    return JokeResponse.parse(await response.json()).joke;
  } catch {
    return FALLBACK_JOKE;
  }
}
