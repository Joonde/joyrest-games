import { defineConfig } from "vitest/config";

// Тесты правил Firestore. Запускаются только внутри эмулятора: npm run test:rules
export default defineConfig({
  test: {
    include: ["tests/rules/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
