import { readAcquisitions } from './acquisition-store.ts';
import { stackConfig, stackConfigFile, vpnReady } from './stack-config.ts';
import { storageStatus } from './acquisition-storage.ts';

export function acquisitionView() {
  const s = readAcquisitions(),
    c = stackConfig();
  const workerFresh = !!s.workerAt && Date.now() - Date.parse(s.workerAt) < 120_000;
  const guardFresh = !!s.guardAt && Date.now() - Date.parse(s.guardAt) < 30_000;
  const services: Record<string, { ok: boolean; note?: string }> = {
    ...s.services,
    worker: {
      ok: workerFresh,
      note: workerFresh ? undefined : 'The download worker has not reported recently.',
    },
    guard: {
      ok: guardFresh,
      note: guardFresh ? undefined : 'Downloads are paused until the storage guard is ready.',
    },
  };
  delete services.vpn;
  if (c.networkMode === 'vpn' && !vpnReady(c))
    services.network = {
      ok: false,
      note: 'Save a Proton WireGuard configuration with NAT-PMP enabled.',
    };
  const setup: string[] = [];
  if (!c.enabled) setup.push('Finish media stack setup.');
  if (!c.sonarr.apiKey || !c.radarr.apiKey)
    setup.push('Connect Sonarr and Radarr and select their Journal quality profiles.');
  if (!c.prowlarr.apiKey) setup.push('Configure and test download sources in Prowlarr.');
  if (!c.jellyfin.apiKey || !c.jellyfin.userId)
    setup.push('Connect a dedicated Jellyfin playback user.');
  const staleStorage = !guardFresh;
  return {
    requests: s.requests,
    services,
    setup,
    enabled: c.enabled,
    networkMode: c.networkMode,
    ready: c.enabled && !setup.length && Object.values(services).every((x) => x.ok),
    storage: staleStorage ? storageStatus(c) : s.storage || storageStatus(c),
    workerAt: s.workerAt,
    guardAt: s.guardAt,
    configPath: stackConfigFile(),
  };
}
export type AcquisitionView = ReturnType<typeof acquisitionView>;
