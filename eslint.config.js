// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  {
    ignores: ["dist/*"],
  },
  expoConfig,
  {
    rules: {
      "react/no-unescaped-entities": "off",
    },
  },
  // ── Scoped override for Deno Edge Functions ──────────────────────────────
  // These files run on Deno, not Node.js. They use the global `Deno` object
  // and import dependencies via pinned https:// URLs (esm.sh, deno.land).
  // We declare the Deno global and disable only the rules that are
  // fundamentally incompatible with Deno's module resolution model.
  // General correctness rules (no-unused-vars, no-undef, etc.) remain active.
  {
    files: ["supabase/functions/**/*.ts"],
    languageOptions: {
      globals: {
        Deno: "readonly",
      },
    },
    rules: {
      // Deno uses https:// URLs for imports; the resolver cannot resolve them
      "import/no-unresolved": "off",
      // Deno requires explicit file extensions in imports (e.g. './handler.ts')
      "import/extensions": "off",
    },
  },
]);
