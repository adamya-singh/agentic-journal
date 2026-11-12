import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { stackConfig, stackConfigFile, vpnReady } from '../src/lib/media/stack-config.ts';
import { assertStorage } from '../src/lib/media/acquisition-storage.ts';
import { configureQbitRouting } from '../src/lib/media/stack-routing.ts';
import { ArrClient, jellyCall, serviceFetch } from '../src/lib/media/stack-clients.ts';

interface Field {
  name: string;
  value?: unknown;
}
interface SettingsDocument {
  id: number;
  name: string;
  implementation: string;
  fields: Field[];
  tags: number[];
  [key: string]: unknown;
}
interface QualityItem {
  items?: QualityItem[];
  quality?: { id: number; resolution: number; name: string };
  allowed: boolean;
}
interface QualityProfile {
  id: number;
  name: string;
  items: QualityItem[];
  formatItems: { format: number; name: string; score: number }[];
  [key: string]: unknown;
}
interface JellyDocument {
  Id: string;
  Name: string;
  Policy: Record<string, unknown>;
  Configuration: Record<string, unknown>;
  [key: string]: unknown;
}

const base = process.env.MEDIA_STACK_HOME || '/home/openclaw/media-stack';
process.env.MEDIA_STACK_CONFIG ||= path.join(base, 'config.json');
const root = path.resolve(import.meta.dirname, '..');
const composeFile = path.join(root, 'ops/media-stack/compose.yml');
const imagesFile = path.join(root, 'ops/media-stack/images.lock');
const cmd = process.argv[2] || 'status';
const secret = () => randomBytes(24).toString('hex');
function writePrivate(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
  if (process.getuid?.() === 0) fs.chownSync(file, 1000, 1000);
}
function shell(bin: string, args: string[], capture = false) {
  const r = spawnSync(bin, args, { stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${bin} failed. Check local service logs.`);
  return r.stdout?.trim() || '';
}
function docker(args: string[], capture = false) {
  return process.getuid?.() === 0
    ? shell('docker', args, capture)
    : shell('sudo', ['-n', 'docker', ...args], capture);
}
function compose(args: string[]) {
  const c = stackConfig();
  assertStorage(c);
  const env = path.join(base, 'compose.env');
  const renderGid = fs.existsSync('/dev/dri/renderD128')
    ? fs.statSync('/dev/dri/renderD128').gid
    : 0;
  fs.writeFileSync(
    env,
    `MEDIA_STACK_HOME=${base}\nMEDIA_DATA_ROOT=${c.dataRoot}\nRENDER_GID=${renderGid}\nJOURNAL_STORAGE_ID=${c.storageId}\n`,
    { mode: 0o600 },
  );
  docker([
    'compose',
    '--env-file',
    imagesFile,
    '--env-file',
    env,
    '-f',
    composeFile,
    ...(c.networkMode === 'vpn' ? ['-f', path.join(root, 'ops/media-stack/vpn.yml')] : []),
    ...(c.hardwareAcceleration ? ['-f', path.join(root, 'ops/media-stack/hardware.yml')] : []),
    ...args,
  ]);
}
async function startStack() {
  const c = stackConfig();
  ensureCache();
  // Stop the shared-config downloader before changing interface/DNS settings.
  const { guardDownloads } = await import('../src/lib/media/acquisition-worker.ts');
  try {
    await guardDownloads(c, true);
  } catch {
    /* Initial setup has no downloader yet. */
  }
  compose(['--profile', 'vpn', 'stop', 'qbittorrent', 'gluetun']);
  const file = path.join(base, 'services/qbittorrent/qBittorrent/qBittorrent.conf');
  fs.writeFileSync(file, configureQbitRouting(fs.readFileSync(file, 'utf8'), c.networkMode), {
    mode: 0o600,
  });
  fs.writeFileSync(
    path.join(base, 'services/qbittorrent/resolv.conf'),
    `nameserver ${c.networkMode === 'vpn' ? '127.0.0.1' : '127.0.0.11'}\noptions timeout:2 attempts:1\n`,
    { mode: 0o600 },
  );
  const targets =
    c.networkMode === 'vpn' && !fs.existsSync(path.join(base, 'proton/wg0.conf'))
      ? ['sonarr', 'radarr', 'prowlarr', 'jellyfin']
      : [];
  compose([
    ...(c.networkMode === 'vpn' ? ['--profile', 'vpn'] : []),
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    '150',
    ...targets,
  ]);
}
function ensureCache() {
  const mount = path.join(base, 'cache/transcodes');
  fs.mkdirSync(mount, { recursive: true });
  if (spawnSync('mountpoint', ['-q', mount]).status === 0) return;
  const image = path.join(base, 'cache/transcodes.ext4');
  if (!fs.existsSync(image)) {
    const fd = fs.openSync(image, 'wx', 0o600);
    fs.ftruncateSync(fd, 8 * 1024 ** 3);
    fs.closeSync(fd);
    shell('sudo', ['-n', 'mkfs.ext4', '-q', '-F', image]);
  }
  shell('sudo', ['-n', 'mount', '-o', 'loop,nosuid,nodev,noexec', image, mount]);
  shell('sudo', ['-n', 'chown', '1000:1000', mount]);
}
function init() {
  if (fs.existsSync(stackConfigFile()))
    throw new Error('Configuration exists; initialization will not overwrite it.');
  const config = JSON.parse(
    fs.readFileSync(path.join(root, 'ops/media-stack/config.example.json'), 'utf8'),
  );
  const dataRoot = path.join(base, 'data');
  config.dataRoot = dataRoot;
  config.vpnStatusFile = path.join(base, 'runtime/vpn.json');
  config.storageId = secret();
  for (const dir of [
    'proton',
    'runtime',
    'cache/jellyfin',
    'services/jellyfin',
    'services/qbittorrent/qBittorrent',
    'services/sonarr',
    'services/radarr',
    'services/prowlarr',
    'data/torrents/incomplete',
    'data/torrents/completed',
    'data/library/movies',
    'data/library/shows',
  ])
    fs.mkdirSync(path.join(base, dir), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dataRoot, '.journal-storage'), config.storageId + '\n', {
    mode: 0o600,
  });
  const credentials = {
    username: 'journal',
    password: secret(),
    jellyfinAdminPassword: secret(),
    jellyfinPlaybackPassword: secret(),
  };
  config.qbittorrent.password = credentials.password;
  for (const name of ['sonarr', 'radarr', 'prowlarr']) {
    config[name].apiKey = secret().slice(0, 32);
    const port = { sonarr: 8989, radarr: 7878, prowlarr: 9696 }[name];
    fs.writeFileSync(
      path.join(base, 'services', name, 'config.xml'),
      `<Config><BindAddress>*</BindAddress><Port>${port}</Port><ApiKey>${config[name].apiKey}</ApiKey><AuthenticationMethod>Forms</AuthenticationMethod><AuthenticationRequired>Enabled</AuthenticationRequired><LogLevel>info</LogLevel><Branch>master</Branch></Config>`,
      { mode: 0o600 },
    );
  }
  const salt = randomBytes(16),
    hash = pbkdf2Sync(credentials.password, salt, 100000, 64, 'sha512');
  const qbit = `[BitTorrent]\nSession\\DefaultSavePath=/data/torrents/completed\nSession\\TempPath=/data/torrents/incomplete\nSession\\TempPathEnabled=true\nSession\\Interface=tun0\nSession\\QueueingSystemEnabled=true\nSession\\MaxActiveDownloads=2\nSession\\AddTorrentStopped=true\nSession\\Port=0\nSession\\GlobalMaxRatio=1\nSession\\GlobalMaxSeedingMinutes=1440\n\n[Preferences]\nWebUI\\Address=*\nWebUI\\Port=8080\nWebUI\\Username=journal\nWebUI\\Password_PBKDF2="@ByteArray(${salt.toString('base64')}:${hash.toString('base64')})"\nWebUI\\LocalHostAuth=false\nWebUI\\AuthSubnetWhitelistEnabled=false\nConnection\\UPnP=false\n`;
  fs.writeFileSync(path.join(base, 'services/qbittorrent/qBittorrent/qBittorrent.conf'), qbit, {
    mode: 0o600,
  });
  fs.writeFileSync(
    path.join(base, 'services/qbittorrent/resolv.conf'),
    'nameserver 127.0.0.1\noptions timeout:2 attempts:1\n',
    { mode: 0o600 },
  );
  writePrivate(path.join(base, 'credentials.json'), credentials);
  writePrivate(stackConfigFile(), config);
  console.log(
    `Initialized private configuration at ${stackConfigFile()}. No VPN connection has been started.`,
  );
}
async function provision() {
  const c = stackConfig();
  const credentials = JSON.parse(fs.readFileSync(path.join(base, 'credentials.json'), 'utf8'));
  for (const kind of ['film', 'series'] as const) {
    const client = new ArrClient(kind === 'film' ? c.radarr : c.sonarr, kind);
    const profiles = await client.call<QualityProfile[]>('qualityprofile');
    let profile = profiles.find((p) => p.name === 'Journal 1080p SDR');
    if (!profile) {
      const schema = await client.call<QualityProfile>('qualityprofile/schema');
      const configure = (items: QualityItem[]): QualityItem[] =>
        items.map((item) => ({
          ...item,
          ...(item.items?.length ? { items: configure(item.items) } : {}),
          allowed: item.quality
            ? [720, 1080].includes(item.quality.resolution) && !/remux|raw/i.test(item.quality.name)
            : true,
        }));
      const items = configure(schema.items);
      const flat = items.flatMap((x: QualityItem) => (x.items?.length ? x.items : [x]));
      const cutoff = flat
        .filter((x: QualityItem) => x.allowed && x.quality?.resolution === 1080)
        .at(-1)?.quality?.id;
      if (!cutoff) throw new Error('No 1080p qualities available.');
      profile = await client.call<QualityProfile>('qualityprofile', {
        ...schema,
        id: undefined,
        name: 'Journal 1080p SDR',
        upgradeAllowed: false,
        cutoff,
        items,
        minFormatScore: 0,
        cutoffFormatScore: 0,
        language: { id: -2, name: 'Original' },
      });
    }
    (kind === 'film' ? c.radarr : c.sonarr).profileId = profile.id;
    writePrivate(stackConfigFile(), c);
    const formats = await client.call<SettingsDocument[]>('customformat');
    let hdr = formats.find((f) => f.name === 'Journal reject HDR');
    if (!hdr)
      hdr = await client.call<SettingsDocument>('customformat', {
        name: 'Journal reject HDR',
        includeCustomFormatWhenRenaming: false,
        specifications: [
          {
            name: 'HDR or Dolby Vision',
            implementation: 'ReleaseTitleSpecification',
            negate: false,
            required: false,
            fields: [{ name: 'value', value: '\\b(HDR(?:10\\+?)?|DV|DOVI|Dolby[ ._-]?Vision)\\b' }],
          },
        ],
      });
    const latestProfile = await client.call<QualityProfile>(`qualityprofile/${profile.id}`);
    await client.call(
      `qualityprofile/${profile.id}`,
      {
        ...latestProfile,
        minFormatScore: 0,
        formatItems: [
          ...latestProfile.formatItems.filter((f) => f.format !== hdr.id),
          { format: hdr.id, name: hdr.name, score: -10000 },
        ],
      },
      'PUT',
    );
    const folders = await client.call<SettingsDocument[]>('rootfolder');
    const folder = `/data/library/${kind === 'film' ? 'movies' : 'shows'}`;
    if (!folders.some((f) => f.path === folder)) await client.call('rootfolder', { path: folder });
    const naming = await client.call<SettingsDocument>('config/mediamanagement');
    await client.call(
      `config/mediamanagement/${naming.id}`,
      { ...naming, copyUsingHardlinks: true },
      'PUT',
    );
    const clients = await client.call<SettingsDocument[]>('downloadclient');
    const name = 'Journal qBittorrent';
    const old = clients.find((x) => x.name === name);
    const schema = (await client.call<SettingsDocument[]>('downloadclient/schema')).find(
      (x) => x.implementation === 'QBittorrent',
    );
    const template = old || schema;
    if (!template) throw new Error('qBittorrent settings schema is unavailable.');
    const values: Record<string, unknown> = {
      host: c.networkMode === 'vpn' ? 'gluetun' : 'qbittorrent',
      port: 8080,
      useSsl: false,
      username: 'journal',
      password: credentials.password,
      category: kind === 'film' ? 'journal-radarr' : 'journal-sonarr',
      tvCategory: 'journal-sonarr',
      movieCategory: 'journal-radarr',
      initialState: 2,
    };
    const clientSettings = {
      ...template,
      name,
      enable: true,
      priority: 1,
      fields: template.fields.map((f: Field) => ({
        ...f,
        value: f.name in values ? values[f.name] : f.value,
      })),
    };
    if (c.networkMode === 'direct' || fs.existsSync(path.join(base, 'proton/wg0.conf')))
      await client.call(
        `downloadclient${old ? `/${old.id}` : ''}`,
        clientSettings,
        old ? 'PUT' : 'POST',
      );
    const auth = await client.call<SettingsDocument>('config/host');
    await client.call(
      `config/host/${auth.id}`,
      {
        ...auth,
        username: credentials.username,
        password: credentials.password,
        passwordConfirmation: credentials.password,
        authenticationMethod: 'forms',
        authenticationRequired: 'enabled',
      },
      'PUT',
    );
  }
  const prowlarr = async <T>(
    route: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ): Promise<T> => {
    const r = await serviceFetch(`${c.prowlarr.url}/api/v1/${route}`, {
      method,
      headers: { 'X-Api-Key': c.prowlarr.apiKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Prowlarr setup failed (${r.status}).`);
    return r.status === 204 ? (undefined as T) : r.json();
  };
  const apps = await prowlarr<SettingsDocument[]>('applications');
  const schemas = await prowlarr<SettingsDocument[]>('applications/schema');
  for (const appName of ['Sonarr', 'Radarr']) {
    const old = apps.find((a) => a.name === `Journal ${appName}`),
      schema = schemas.find((a) => a.implementation === appName);
    const template = old || schema;
    if (!template) throw new Error(`${appName} application settings are unavailable.`);
    const manager = appName === 'Sonarr' ? c.sonarr : c.radarr;
    const values: Record<string, unknown> = {
      prowlarrUrl: 'http://prowlarr:9696',
      baseUrl: `http://${appName.toLowerCase()}:${appName === 'Sonarr' ? 8989 : 7878}`,
      apiKey: manager.apiKey,
    };
    const body = {
      ...template,
      name: `Journal ${appName}`,
      syncLevel: 'fullSync',
      fields: template.fields.map((f: Field) => ({
        ...f,
        value: f.name in values ? values[f.name] : f.value,
      })),
    };
    await prowlarr(`applications${old ? `/${old.id}` : ''}`, body, old ? 'PUT' : 'POST');
  }
  if (c.networkMode === 'direct') {
    const proxies = await prowlarr<SettingsDocument[]>('indexerproxy');
    for (const proxy of proxies.filter((p) => p.name === 'Journal Gluetun'))
      await prowlarr(`indexerproxy/${proxy.id}`, undefined, 'DELETE');
  } else if (fs.existsSync(path.join(base, 'proton/wg0.conf'))) {
    const tags = await prowlarr<SettingsDocument[]>('tag');
    const tag =
      tags.find((x) => x.label === 'journal-vpn') ||
      (await prowlarr<SettingsDocument>('tag', { label: 'journal-vpn' }));
    const proxies = await prowlarr<SettingsDocument[]>('indexerproxy');
    const old = proxies.find((p) => p.name === 'Journal Gluetun');
    const schema = (await prowlarr<SettingsDocument[]>('indexerproxy/schema')).find(
      (p) => p.implementation === 'Http',
    );
    if (!schema) throw new Error('HTTP indexer proxy is unavailable.');
    const values: Record<string, unknown> = { host: 'gluetun', port: 8888 };
    await prowlarr(
      `indexerproxy${old ? `/${old.id}` : ''}`,
      {
        ...(old || schema),
        name: 'Journal Gluetun',
        tags: [tag.id],
        fields: (old || schema).fields.map((f: Field) => ({
          ...f,
          value: f.name in values ? values[f.name] : f.value,
        })),
      },
      old ? 'PUT' : 'POST',
    );
    const indexers = await prowlarr<SettingsDocument[]>('indexer');
    for (const indexer of indexers)
      if (!indexer.tags.includes(tag.id))
        await prowlarr(
          `indexer/${indexer.id}`,
          { ...indexer, tags: [...indexer.tags, tag.id] },
          'PUT',
        );
  }
  const host = await prowlarr<SettingsDocument>('config/host');
  await prowlarr(
    `config/host/${host.id}`,
    {
      ...host,
      username: credentials.username,
      password: credentials.password,
      passwordConfirmation: credentials.password,
      authenticationMethod: 'forms',
      authenticationRequired: 'enabled',
    },
    'PUT',
  );
  if (!c.jellyfin.adminKey) {
    const publicInfo = await serviceFetch(`${c.jellyfin.url}/System/Info/Public`);
    const info = await publicInfo.json();
    if (info.StartupWizardCompleted)
      throw new Error(
        'Jellyfin is already initialized. Configure its admin key locally before provisioning.',
      );
    for (const [route, body] of [
      [
        'Startup/Configuration',
        { UICulture: 'en-US', MetadataCountryCode: 'US', PreferredMetadataLanguage: 'en' },
      ],
      ['Startup/User', { Name: 'journal-admin', Password: credentials.jellyfinAdminPassword }],
      ['Startup/RemoteAccess', { EnableRemoteAccess: false, EnableAutomaticPortMapping: false }],
      ['Startup/Complete', {}],
    ] as const) {
      if (route === 'Startup/User') {
        const first = await serviceFetch(`${c.jellyfin.url}/Startup/User`);
        if (!first.ok) throw new Error('Could not initialize the first Jellyfin user.');
      }
      const r = await serviceFetch(`${c.jellyfin.url}/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`Jellyfin startup ${route} failed (${r.status}).`);
    }
    const r = await serviceFetch(`${c.jellyfin.url}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:
          'MediaBrowser Client="Journal setup", Device="Journal", DeviceId="journal-setup", Version="1"',
      },
      body: JSON.stringify({ Username: 'journal-admin', Pw: credentials.jellyfinAdminPassword }),
    });
    if (!r.ok) throw new Error('Jellyfin admin authentication failed.');
    c.jellyfin.adminKey = (await r.json()).AccessToken;
    writePrivate(stackConfigFile(), c);
  }
  if (!c.jellyfin.userId) {
    const users = await jellyCall<JellyDocument[]>(c, 'Users', undefined, 'GET', true);
    let user = users.find((u) => u.Name === 'journal-player');
    if (!user)
      user = await jellyCall<JellyDocument>(
        c,
        'Users/New',
        { Name: 'journal-player', Password: credentials.jellyfinPlaybackPassword },
        'POST',
        true,
      );
    await jellyCall(
      c,
      `Users/${user.Id}/Policy`,
      {
        ...user.Policy,
        IsAdministrator: false,
        EnableAllFolders: true,
        EnableMediaPlayback: true,
        EnableVideoPlaybackTranscoding: true,
        EnableAudioPlaybackTranscoding: true,
        EnablePlaybackRemuxing: true,
        EnableContentDeletion: false,
        EnableRemoteAccess: true,
      },
      'POST',
      true,
    );
    const r = await serviceFetch(`${c.jellyfin.url}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:
          'MediaBrowser Client="Agentic Journal", Device="Journal", DeviceId="journal", Version="1"',
      },
      body: JSON.stringify({
        Username: 'journal-player',
        Pw: credentials.jellyfinPlaybackPassword,
      }),
    });
    if (!r.ok) throw new Error('Jellyfin playback authentication failed.');
    c.jellyfin.apiKey = (await r.json()).AccessToken;
    c.jellyfin.userId = user.Id;
    writePrivate(stackConfigFile(), c);
  }
  const player = await jellyCall<JellyDocument>(c, `Users/${c.jellyfin.userId}`);
  await jellyCall(c, `Users/${c.jellyfin.userId}/Configuration`, {
    ...player.Configuration,
    AudioLanguagePreference: '',
    PlayDefaultAudioTrack: true,
    SubtitleLanguagePreference: 'eng',
    SubtitleMode: 'Default',
  });
  const libs = await jellyCall<JellyDocument[]>(
    c,
    'Library/VirtualFolders',
    undefined,
    'GET',
    true,
  );
  for (const [name, kind, folder] of [
    ['Journal Movies', 'movies', 'movies'],
    ['Journal Shows', 'tvshows', 'shows'],
  ]) {
    if (!libs.some((l) => l.Name === name))
      await jellyCall(
        c,
        `Library/VirtualFolders?name=${encodeURIComponent(name)}&collectionType=${kind}&refreshLibrary=true`,
        {
          LibraryOptions: {
            PathInfos: [{ Path: `/data/library/${folder}` }],
            EnableRealtimeMonitor: true,
            PreferredMetadataLanguage: 'en',
            MetadataCountryCode: 'US',
            EnableEmbeddedTitles: false,
          },
        },
        'POST',
        true,
      );
  }
  const encoding = await jellyCall<Record<string, unknown>>(
    c,
    'System/Configuration/encoding',
    undefined,
    'GET',
    true,
  );
  await jellyCall(
    c,
    'System/Configuration/encoding',
    {
      ...encoding,
      TranscodingTempPath: '/cache/transcodes',
      HardwareAccelerationType: c.hardwareAcceleration ? 'vaapi' : 'none',
      VaapiDevice: '/dev/dri/renderD128',
      EnableThrottling: true,
      ThrottleDelaySeconds: 60,
      EnableSegmentDeletion: true,
      SegmentKeepSeconds: 120,
    },
    'POST',
    true,
  );
  for (const kind of ['film', 'series'] as const) {
    const client = new ArrClient(kind === 'film' ? c.radarr : c.sonarr, kind);
    const name = 'Journal Jellyfin library refresh';
    const existing = (await client.call<SettingsDocument[]>('notification')).find(
      (n) => n.name === name,
    );
    const schema = (await client.call<SettingsDocument[]>('notification/schema')).find(
      (n) => n.implementation === 'MediaBrowser',
    );
    if (!schema) throw new Error('Jellyfin import notification settings are unavailable.');
    const template = existing || schema;
    const values: Record<string, unknown> = {
      host: 'jellyfin',
      port: 8096,
      useSsl: false,
      apiKey: c.jellyfin.adminKey,
      notify: false,
      updateLibrary: true,
    };
    const settings = {
      ...template,
      name,
      onDownload: true,
      onUpgrade: true,
      ...(schema.supportsOnImportComplete ? { onImportComplete: true } : {}),
      fields: template.fields.map((field) => ({
        ...field,
        value: field.name in values ? values[field.name] : field.value,
      })),
    };
    await client.call('notification/test', settings);
    await client.call(
      `notification${existing ? `/${existing.id}` : ''}`,
      settings,
      existing ? 'PUT' : 'POST',
    );
  }
  writePrivate(stackConfigFile(), c);
  console.log(
    'Managers, quality profiles, source synchronization, and private playback configured. Add sources in Prowlarr; then run enable.',
  );
}
async function main() {
  if (cmd === 'init') return init();
  if (cmd === 'lock-images') {
    const specs = {
      GLUETUN: 'qmcgaw/gluetun:v3.41.3',
      QBITTORRENT: 'lscr.io/linuxserver/qbittorrent:latest',
      SONARR: 'lscr.io/linuxserver/sonarr:latest',
      RADARR: 'lscr.io/linuxserver/radarr:latest',
      PROWLARR: 'lscr.io/linuxserver/prowlarr:latest',
      JELLYFIN: 'jellyfin/jellyfin:latest',
    };
    const lines: string[] = [];
    for (const [name, image] of Object.entries(specs)) {
      docker(['pull', image]);
      const digest = docker(
        ['image', 'inspect', '--format', '{{index .RepoDigests 0}}', image],
        true,
      );
      if (!digest.includes('@sha256:')) throw new Error('Image is not pinned.');
      lines.push(`${name}_IMAGE=${digest}`);
    }
    fs.writeFileSync(imagesFile, lines.join('\n') + '\n');
    return;
  }
  const c = stackConfig();
  if (cmd === 'check-storage') {
    assertStorage(c);
    return;
  }
  if (cmd === 'up') return startStack();
  if (cmd === 'mode') {
    const mode = process.argv[3];
    if (mode !== 'direct' && mode !== 'vpn') throw new Error('Choose mode direct or mode vpn.');
    c.enabled = false;
    writePrivate(stackConfigFile(), c);
    compose(['--profile', 'vpn', 'stop', 'qbittorrent', 'gluetun']);
    c.networkMode = mode;
    writePrivate(stackConfigFile(), c);
    await startStack();
    await provision();
    console.log(
      `Network mode is ${mode}. Acquisition stays paused until source checks pass and enable is run.`,
    );
    return;
  }
  if (cmd === 'down') return compose(['--profile', 'vpn', 'down']);
  if (cmd === 'provision') return provision();
  if (cmd === 'verify-vpn') {
    if (c.networkMode !== 'vpn')
      throw new Error('Select mode vpn before running VPN verification.');
    if (!vpnReady(c))
      throw new Error('Start Proton and wait for a healthy forwarded-port attestation first.');
    c.enabled = false;
    writePrivate(stackConfigFile(), c);
    const { guardDownloads } = await import('../src/lib/media/acquisition-worker.ts');
    await guardDownloads(c, true);
    const id = (service: string) =>
      docker(
        [
          'ps',
          '-q',
          '--filter',
          'label=com.docker.compose.project=journal-media',
          '--filter',
          `label=com.docker.compose.service=${service}`,
        ],
        true,
      );
    const vpn = id('gluetun'),
      qbit = id('qbittorrent');
    if (!vpn || !qbit) throw new Error('VPN containers are not running.');
    const hostIp = (await (await serviceFetch('https://api.ipify.org')).text()).trim();
    const vpnIp = docker(
      ['exec', qbit, 'curl', '-fsS', '--max-time', '8', 'https://api.ipify.org'],
      true,
    );
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(vpnIp) || vpnIp === hostIp)
      throw new Error('Downloader egress is not distinct from the host.');
    const dns = docker(['exec', qbit, 'cat', '/etc/resolv.conf'], true);
    if (!/^nameserver 127\.0\.0\.1$/m.test(dns))
      throw new Error('Downloader DNS must use the Gluetun resolver.');
    try {
      docker(['stop', vpn]);
      for (const destination of ['https://api.ipify.org', 'http://1.1.1.1']) {
        const args = ['exec', qbit, 'curl', '-sS', '--max-time', '5', destination];
        const result =
          process.getuid?.() === 0
            ? spawnSync('docker', args, { stdio: 'ignore' })
            : spawnSync('sudo', ['-n', 'docker', ...args], { stdio: 'ignore' });
        if (result.status === 0) {
          docker(['stop', qbit]);
          throw new Error(
            'VPN outage test detected reachable egress. Downloader stopped; do not enable acquisition.',
          );
        }
      }
    } finally {
      compose([
        '--profile',
        'vpn',
        'up',
        '-d',
        '--force-recreate',
        '--wait',
        '--wait-timeout',
        '150',
        'gluetun',
        'qbittorrent',
      ]);
    }
    // The independent status service must attest the newly created namespace and new port.
    const before = Date.now();
    while (
      (!vpnReady(c) || JSON.parse(fs.readFileSync(c.vpnStatusFile, 'utf8')).at <= before) &&
      Date.now() - before < 30_000
    )
      await new Promise((r) => setTimeout(r, 1000));
    if (!vpnReady(c)) throw new Error('Forwarding did not recover after container recreation.');
    console.log(
      'VPN egress, local DNS, outage blocking, container recreation, and forwarding recovery passed. Run enable after source checks pass.',
    );
    return;
  }
  if (cmd === 'hardware') {
    if (!fs.existsSync('/dev/dri/renderD128')) throw new Error('No render device available.');
    const image = fs
      .readFileSync(imagesFile, 'utf8')
      .split('\n')
      .find((s) => s.startsWith('JELLYFIN_IMAGE='))
      ?.split('=')
      .slice(1)
      .join('=');
    if (!image) throw new Error('Jellyfin image lock missing.');
    docker([
      'run',
      '--rm',
      '--network=none',
      '--device',
      '/dev/dri/renderD128:/dev/dri/renderD128',
      '--user',
      '1000:1000',
      '--group-add',
      String(fs.statSync('/dev/dri/renderD128').gid),
      '--entrypoint',
      '/usr/lib/jellyfin-ffmpeg/ffmpeg',
      image,
      '-v',
      'error',
      '-init_hw_device',
      'vaapi=va:/dev/dri/renderD128',
      '-filter_hw_device',
      'va',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1280x720:rate=24',
      '-vf',
      'format=nv12,hwupload',
      '-frames:v',
      '24',
      '-c:v',
      'h264_vaapi',
      '-f',
      'null',
      '-',
    ]);
    c.hardwareAcceleration = true;
    writePrivate(stackConfigFile(), c);
    console.log(
      'AMD VA-API encoding probe passed. Run up and provision to activate hardware acceleration.',
    );
    return;
  }
  if (cmd === 'import-proton') {
    const source = process.argv[3];
    if (!source || !path.isAbsolute(source))
      throw new Error('Provide an absolute WireGuard configuration path.');
    const text = fs.readFileSync(source, 'utf8');
    if (!/^PrivateKey\s*=\s*[A-Za-z0-9+/]{43}=/m.test(text) || !/^\[Peer\]/m.test(text))
      throw new Error('Not a WireGuard configuration.');
    const dest = path.join(base, 'proton/wg0.conf');
    fs.copyFileSync(source, dest);
    fs.chmodSync(dest, 0o600);
    console.log(
      'Proton configuration saved privately. NAT-PMP will be checked when the VPN starts.',
    );
    return;
  }
  if (cmd === 'enable') {
    const { stackHealth } = await import('../src/lib/media/acquisition-worker.ts');
    c.enabled = true;
    const health = await stackHealth(c);
    delete health.setup;
    if (!Object.values(health).every((s) => s.ok)) {
      console.log(JSON.stringify(health, null, 2));
      throw new Error('Setup checks have not all passed.');
    }
    writePrivate(stackConfigFile(), c);
    console.log('Downloads enabled.');
    return;
  }
  if (cmd === 'status') {
    const { acquisitionView } = await import('../src/lib/media/acquisition-view.ts');
    console.log(JSON.stringify(acquisitionView(), null, 2));
    return;
  }
  if (cmd === 'migrate') {
    const dest = process.argv[3];
    if (
      !dest ||
      !path.isAbsolute(dest) ||
      /[\s\n]/.test(dest) ||
      path.resolve(dest).startsWith(c.dataRoot + '/')
    )
      throw new Error('Provide a separate absolute destination path without whitespace.');
    assertStorage(c);
    const apply = process.argv.includes('--execute');
    console.log(
      `Copy ${c.dataRoot} to ${dest}; preserve hardlinks and checksums. Original data will remain.`,
    );
    if (!apply) {
      console.log('Preview only. Add --execute to stop media services and migrate.');
      return;
    }
    if (!fs.existsSync(dest) || fs.readdirSync(dest).length)
      throw new Error('Destination must be an existing empty directory on the mounted drive.');
    if (fs.realpathSync(dest) !== path.resolve(dest))
      throw new Error('Migration target must not be a symlink.');
    const sourceDev = fs.statSync(c.dataRoot).dev;
    if (sourceDev === fs.statSync(dest).dev)
      throw new Error('Migration target must be on another mounted filesystem.');
    for (const name of [
      'agentic-journal-acquisition-worker',
      'agentic-journal-acquisition-guard',
      'journal-media-stack',
    ])
      shell('sudo', ['-n', 'systemctl', 'stop', name]);
    shell('rsync', ['-aH', '--checksum', c.dataRoot + '/', dest + '/']);
    const diff = shell(
      'rsync',
      ['-aHnc', '--delete', '--itemize-changes', c.dataRoot + '/', dest + '/'],
      true,
    );
    if (diff)
      throw new Error(
        'Migration verification failed. Original configuration retained; media services remain stopped.',
      );
    c.dataRoot = dest;
    assertStorage(c);
    writePrivate(stackConfigFile(), c);
    for (const name of [
      'journal-media-stack',
      'agentic-journal-acquisition-guard',
      'agentic-journal-acquisition-worker',
    ])
      shell('sudo', ['-n', 'systemctl', 'start', name]);
    console.log('Migration complete. Original files retained for recovery.');
    return;
  }
  throw new Error(
    'Unknown command. Use init, lock-images, up, mode direct|vpn, provision, import-proton, verify-vpn, enable, status, migrate, or down.',
  );
}
await main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
