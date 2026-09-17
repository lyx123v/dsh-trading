import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // host 路由/凭据/缓存测试走 node；视图渲染测试文件内 @vitest-environment jsdom 指定
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
  },
})
