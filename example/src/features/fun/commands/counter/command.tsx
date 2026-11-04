import { defineCommand } from "neocord";
import { Counter } from "../../_components/Counter";

export default defineCommand({
  description: "A counter anyone in the channel can click",
  execute: () => <Counter />,
});
