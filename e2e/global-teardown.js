import fs from 'fs';
import { applyE2eEnv } from './support/env.js';
import { dropDatabase } from './support/db.js';

export default async function teardown() {
  applyE2eEnv();
  await dropDatabase();
  if (process.env.UPLOAD_DIR?.includes('vanspend-e2e-uploads-')) {
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
  }
}
