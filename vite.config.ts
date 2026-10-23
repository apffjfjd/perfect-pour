import { defineConfig } from 'vitest/config';

// base './' : GitHub Pages 저장소 하위 경로(/repo/)와 사용자 지정 도메인 모두에서 동작하도록 상대 경로로 빌드한다.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
