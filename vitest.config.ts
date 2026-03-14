/// <reference types="vitest" />

export default {
  test: {
    environment: 'node',
    include: ['src/server/**/*.test.ts'],
    exclude: ['node_modules/**'],
  },
};
