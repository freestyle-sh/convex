import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Keep the real Gateway SDK, but let tests substitute Convex's token syscall.
    server: { deps: { inline: ["@convex-dev/ai-sdk-provider"] } },
  },
});
