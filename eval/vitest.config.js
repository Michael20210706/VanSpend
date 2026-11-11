import path from 'path';
import { defineConfig } from 'vitest/config';

// 只跑不需要数据库的评测打分测试: npx vitest run --config eval/vitest.config.js
export default defineConfig({
  root: path.resolve(__dirname, '..'),
  test: { environment: 'node', include: ['tests/eval-score.test.js', 'tests/prompt.test.js'] },
});
