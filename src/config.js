import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  accessToken: process.env.IG_ACCESS_TOKEN || '',
  igUserId: process.env.IG_USER_ID || '',
  appSecret: process.env.APP_SECRET || '',
  verifyToken: process.env.VERIFY_TOKEN || '',
  adminKey: process.env.ADMIN_KEY || '',
  port: Number(process.env.PORT) || 3000,
  graphVersion: process.env.GRAPH_VERSION || 'v23.0',
  dryRun: process.env.DRY_RUN === '1',
  reelsFile: process.env.REELS_FILE || path.join(rootDir, 'reels.json'),
  processedFile: process.env.PROCESSED_FILE || path.join(rootDir, 'data', 'processed.json'),
};
