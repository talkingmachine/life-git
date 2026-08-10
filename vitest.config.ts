import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/.pnpm-store/**", "**/.worktrees/**"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
