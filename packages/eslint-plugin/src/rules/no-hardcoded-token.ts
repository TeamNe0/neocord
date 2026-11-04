import { Buffer } from "node:buffer";
import type { AstNode } from "../utils/ast.ts";
import { createRule } from "../utils/rule.ts";

const TOKEN_SHAPE = /(?<![\w-])([\w-]{23,28})\.[\w-]{6,7}\.[\w-]{27,}(?![\w-])/g;
const SNOWFLAKE = /^\d{17,20}$/;

function containsToken(text: string): boolean {
  for (const match of text.matchAll(TOKEN_SHAPE)) {
    const encodedId = match[1];
    if (encodedId && SNOWFLAKE.test(Buffer.from(encodedId, "base64url").toString("latin1"))) return true;
  }
  return false;
}

export default createRule({
  name: "no-hardcoded-token",
  type: "problem",
  description: "Disallow string literals shaped like Discord bot tokens.",
  messages: {
    token: "This looks like a Discord token. Move it to an environment variable and reset the token if it was committed.",
  },
  create(kit) {
    function check(node: AstNode, text: unknown): void {
      if (typeof text === "string" && containsToken(text)) kit.report({ node, messageId: "token" });
    }

    return {
      Literal(node) {
        check(node, node.value);
      },
      JSXText(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, (node.value as { cooked?: unknown }).cooked);
      },
    };
  },
});
