import { register } from 'node:module';

register('./test-alias-loader.mjs', import.meta.url);

// Tests never read the real deploy queue: a deploy waiting to run holds the application worker
// (src/lib/deploy-hold.ts) and would make claim tests fail on this machine only.
process.env.DEPLOY_QUEUE_DIR ??= '/nonexistent/agentic-journal-test-deploy-queue';
