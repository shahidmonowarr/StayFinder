import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/**
 * Shared flat config for every workspace. Kept deliberately small: the rules
 * here are the ones that would otherwise cost review time (unused code,
 * accidental `any`, value/type import mixing), not stylistic ones — Prettier
 * owns formatting and `eslint-config-prettier` turns off anything that overlaps.
 */
export default tseslint.config(
  {
    ignores: ["dist/**", ".next/**", "coverage/**", "**/src/generated/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  prettier,
);
