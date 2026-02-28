import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "build/**",
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "client/public/**",
      "**/__manus__/**",
      "client/src/const.ts",
      "client/src/main.tsx",
      "client/src/hooks/usePersistFn.ts",
      "client/src/hooks/useFileUpload.ts",
      "**/*.test.js",
      "**/*.test.cjs",
      "**/*.test.mjs",
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
  },
  {
    files: ["**/*.{js,cjs,mjs}"],
    ...js.configs.recommended,
    plugins: {
      import: importPlugin,
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: tseslint.configs.recommendedTypeChecked,
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  eslintConfigPrettier,
);
