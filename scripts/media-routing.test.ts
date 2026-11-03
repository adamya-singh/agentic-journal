import test from 'node:test';
import assert from 'node:assert/strict';
import { configureQbitRouting } from '../src/lib/media/stack-routing.ts';

test('routing switches preserve unrelated qBittorrent configuration and restore VPN binding', () => {
  const initial =
    '[BitTorrent]\nSession\\Interface=tun0\nSession\\Port=54321\nSession\\TempPath=/data/torrents/incomplete\n[Preferences]\nWebUI\\Password_PBKDF2=fixture\n';
  const direct = configureQbitRouting(initial, 'direct');
  assert.match(direct, /Session\\Interface=\n/);
  assert.match(direct, /Session\\Port=6881/);
  assert.match(direct, /WebUI\\Password_PBKDF2=fixture/);
  assert.match(direct, /Session\\TempPath=\/data\/torrents\/incomplete/);
  assert.equal(configureQbitRouting(direct, 'direct'), direct);
  const vpn = configureQbitRouting(direct, 'vpn');
  assert.match(vpn, /Session\\Interface=tun0/);
  assert.match(vpn, /Session\\Port=0/);
  assert.match(vpn, /Connection\\UPnP=false/);
  assert.equal((vpn.match(/Session\\Interface=/g) || []).length, 1);
});
