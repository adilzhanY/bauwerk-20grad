import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    // Geometry is pure TypeScript. Three.js must never leak in, see CLAUDE.md.
    files: ["src/geometry/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["three", "three/*", "@react-three/*", "react", "react/*"],
              message: "src/geometry/ stays pure TypeScript.",
            },
          ],
        },
      ],
    },
  },
  {
    // Imports flow one way: shared components, then the parts of each area, then pages. A
    // page is only ever composed, never imported. See "Components" in CLAUDE.md.
    files: [
      "src/components/**/*.{ts,tsx}",
      "src/scene/**/*.{ts,tsx}",
      "src/lib/**/*.ts",
      "src/store/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/pages", "@/pages/*"],
              message: "Pages compose components; nothing imports a page.",
            },
          ],
        },
      ],
    },
  },
  {
    // Shared components are the base every area builds on, so they know no area.
    files: ["src/components/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/pages", "@/pages/*"],
              message: "Pages compose components; nothing imports a page.",
            },
            {
              group: ["@/components/*", "!@/components/shared", "!@/components/shared/*"],
              message:
                "A shared component uses only other shared components. Move what both need into shared/.",
            },
          ],
        },
      ],
    },
  },
  {
    // Test fixtures index into known arrays; a non-null assertion reads better than a guard.
    files: ["**/*.test.{ts,tsx}", "src/geometry/fixtures.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    files: ["eslint.config.js", "vite.config.ts"],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
