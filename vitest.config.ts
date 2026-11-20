import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/catalog/**/*.test.ts'],
    fileParallelism: false, // 資料庫測試共用同一個本機資料庫，依序執行
  },
})
