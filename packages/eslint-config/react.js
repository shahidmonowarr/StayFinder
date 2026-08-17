import globals from "globals";
import base from "./base.js";

/** Config for the Next.js app. */
export default [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
];
