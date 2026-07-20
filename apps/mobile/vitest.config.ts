/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// Tests run on plain Node and cover queue/deep-link logic without a device runtime.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
