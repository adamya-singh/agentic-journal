import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, type Browser, type Page } from 'playwright-core';

const exec = promisify(execFile);
export class BrowserUnavailable extends Error {}

// Ask OpenClaw for its configured profile, rather than launching a second
// browser or copying authentication data into Journal. The caller owns the
// returned tab and closes it (and the CDP connection) when done.
export async function openOpenClawPage(): Promise<{ browser: Browser; page: Page }> {
  const { stdout } = await exec(
    'openclaw',
    ['browser', '--browser-profile', 'openclaw', 'status', '--json'],
    { timeout: 90_000, maxBuffer: 2_000_000 },
  );
  const status = JSON.parse(stdout.slice(stdout.indexOf('{')));
  const endpoint = new URL(status.cdpUrl);
  if (!status.running || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))
    throw new BrowserUnavailable('The local OpenClaw browser is not running.');
  const browser = await chromium.connectOverCDP(endpoint.href, {
    noDefaults: true,
    timeout: 15_000,
  });
  try {
    return { browser, page: await browser.contexts()[0].newPage() };
  } catch (e) {
    await browser.close().catch(() => undefined);
    throw e;
  }
}
