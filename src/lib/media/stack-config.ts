import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';

const localUrl = z
  .string()
  .url()
  .refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) &&
      !u.username &&
      !u.password
    );
  }, 'Media services must use loopback HTTP URLs.');
const service = z.object({ url: localUrl, apiKey: z.string().default('') });
const schema = z.object({
  enabled: z.boolean().default(false),
  networkMode: z.enum(['vpn', 'direct']).default('vpn'),
  dataRoot: z.string().default(path.join(os.homedir(), 'media-stack/data')),
  storageId: z.string().default('agentic-journal-media-v1'),
  budgetGiB: z.number().positive().max(100000).default(150),
  minimumFreeGiB: z.number().positive().default(50),
  hardwareAcceleration: z.boolean().default(false),
  sonarr: service
    .extend({ profileId: z.number().int().positive().optional() })
    .default({ url: 'http://127.0.0.1:8989', apiKey: '' }),
  radarr: service
    .extend({ profileId: z.number().int().positive().optional() })
    .default({ url: 'http://127.0.0.1:7878', apiKey: '' }),
  prowlarr: service.default({ url: 'http://127.0.0.1:9696', apiKey: '' }),
  jellyfin: service
    .extend({ userId: z.string().default(''), adminKey: z.string().default('') })
    .default({ url: 'http://127.0.0.1:8096', apiKey: '', userId: '', adminKey: '' }),
  qbittorrent: z
    .object({ url: localUrl, username: z.string(), password: z.string() })
    .default({ url: 'http://127.0.0.1:8080', username: 'journal', password: '' }),
  vpnStatusFile: z.string().default(path.join(os.homedir(), 'media-stack/runtime/vpn.json')),
});
export type StackConfig = z.infer<typeof schema>;
export const stackConfigFile = () =>
  process.env.MEDIA_STACK_CONFIG || path.join(os.homedir(), 'media-stack/config.json');
export function stackConfig(): StackConfig {
  let raw: unknown = {};
  try {
    raw = JSON.parse(fs.readFileSync(stackConfigFile(), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('Media stack configuration is unreadable.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new Error('Media stack configuration is invalid. Check the local setup file.');
  if (!path.isAbsolute(parsed.data.dataRoot))
    throw new Error('Media storage must use an absolute path.');
  return parsed.data;
}
export function vpnReady(c: StackConfig, now = Date.now()) {
  try {
    const s = JSON.parse(fs.readFileSync(c.vpnStatusFile, 'utf8'));
    return (
      s.healthy === true &&
      Number.isInteger(s.port) &&
      s.port > 0 &&
      now - s.at < 25_000 &&
      now >= s.at
    );
  } catch {
    return false;
  }
}
export const GIB = 1024 ** 3;
