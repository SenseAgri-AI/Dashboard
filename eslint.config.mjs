import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Reference-only clone we port from (Phase 5); not part of this app's build.
    "poultry-layer-log-/**",
  ]),
  {
    rules: {
      // Data-fetching-in-effect is an intentional pattern across the dashboard/logs/
      // analytics pages. Keep it as a warning rather than a build-blocking error.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
