import tseslint from "typescript-eslint";

export default [
  ...tseslint.configs.recommended,
  {
    files: ["src/research/**/*.ts", "src/decision/**/*.ts", "src/branch/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/app/**", "**/experience/**", "**/infrastructure/**"],
              message: "Core modules must not import application, experience, or infrastructure layers.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [".next/**", "node_modules/**"],
  },
];
