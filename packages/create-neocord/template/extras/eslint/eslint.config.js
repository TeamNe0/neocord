import neocord from "@teamneo/neocord-eslint-plugin";
import tsParser from "@typescript-eslint/parser";
export default [
  { ignores: [".neocord/**", "dist/**"] },
  { files: ["**/*.{ts,tsx}"], languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } } },
  neocord.configs.recommended,
];
