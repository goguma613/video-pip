import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'happy-dom', include: ['test/**/*.test.ts'] },
  define: { __VERSION__: JSON.stringify('test') },
});
