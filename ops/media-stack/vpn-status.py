#!/usr/bin/env python3
"""Root-owned service: attest container health, interface binding, and forwarded port."""
import json, os, pathlib, subprocess, time
ROOT = pathlib.Path('/home/openclaw/media-stack')
def docker(*args):
    return subprocess.check_output(['docker', *args], timeout=6, stderr=subprocess.DEVNULL).decode().strip()
while True:
    status = {'healthy': False, 'port': 0, 'at': int(time.time() * 1000)}
    try:
        container = docker('ps', '-q', '--filter', 'label=com.docker.compose.project=journal-media', '--filter', 'label=com.docker.compose.service=gluetun')
        if not container: raise RuntimeError('VPN not started')
        health = docker('inspect', '--format', '{{.State.Health.Status}}', container)
        port = int(docker('exec', container, 'cat', '/tmp/gluetun/forwarded_port'))
        if health != 'healthy' or not 0 < port < 65536: raise RuntimeError('VPN not ready')
        # Only localhost in Gluetun's namespace bypasses qBittorrent authentication.
        prefs = {'listen_port': port, 'current_network_interface': 'tun0', 'random_port': False, 'upnp': False}
        docker('exec', container, 'wget', '-qO-', '--post-data=json=' + json.dumps(prefs), 'http://127.0.0.1:8080/api/v2/app/setPreferences')
        actual = json.loads(docker('exec', container, 'wget', '-qO-', 'http://127.0.0.1:8080/api/v2/app/preferences'))
        status['healthy'] = actual.get('listen_port') == port and actual.get('current_network_interface') == 'tun0'
        status['port'] = port
    except Exception:
        pass
    runtime = ROOT / 'runtime'
    runtime.mkdir(mode=0o700, exist_ok=True)
    temp = runtime / 'vpn.json.tmp'
    temp.write_text(json.dumps(status))
    os.chown(temp, 1000, 1000)
    os.chmod(temp, 0o600)
    temp.replace(runtime / 'vpn.json')
    time.sleep(5)
