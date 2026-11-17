// What the session rows need to know of a device beyond its proj alias: which Codex runs there when `codex` is not on
// its login shell's PATH (the Mac's ChatGPT.app carries its own), so a row's resume command works there. The collector
// notes it on each run (data/session-index/devices.json); the rows read it.
import fs from 'node:fs';
import path from 'node:path';
import { sessionIndexDir } from './store.ts';

type Hosts = Record<string, { codex?: string }>;

const devicesFile = () => path.join(sessionIndexDir(), 'devices.json');
let cache: { file: string; mtimeMs: number; hosts: Hosts } | null = null;

function readDevices(): Hosts {
  const file = devicesFile();
  try {
    const { mtimeMs } = fs.statSync(file);
    if (cache?.file === file && cache.mtimeMs === mtimeMs) return cache.hosts;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { hosts?: Hosts };
    cache = { file, mtimeMs, hosts: raw?.hosts && typeof raw.hosts === 'object' ? raw.hosts : {} };
    return cache.hosts;
  } catch {
    return {};
  }
}

/** The Codex to run on a device for its resume commands (`~/…` or a full path), when `codex` is not on its PATH. */
export function deviceCodex(host: string): string | null {
  const codex = readDevices()[host]?.codex;
  return typeof codex === 'string' && codex ? codex : null;
}

/** What the collector found on a device this run (null: `codex` is on its PATH, or there is none). */
export function noteDeviceCodex(host: string, codex: string | null): void {
  const hosts: Hosts = { ...readDevices() };
  if ((hosts[host]?.codex ?? null) === codex) return;
  if (codex) hosts[host] = { codex }; else delete hosts[host];
  const file = devicesFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ v: 1, hosts }), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
