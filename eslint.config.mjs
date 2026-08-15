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
    // Written by `supabase start` (Edge Runtime secrets bundle) — gitignored but not eslint-ignored
    // by default, which produced ~154 spurious errors until this was added (see qa-review notes,
    // ai-context/PROGRESS.md's Phase 8k/8l qa-review entry, 2026-08-13).
    "supabase/.temp/**",
  ]),
]);

export default eslintConfig;
