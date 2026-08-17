import globals from "globals";
import base from "./base.js";

/** Config for the Node services: core API and the three mock suppliers. */
export default [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Services legitimately log to stdout on boot.
    files: ["src/index.ts", "src/server.ts"],
    rules: { "no-console": "off" },
  },
];
