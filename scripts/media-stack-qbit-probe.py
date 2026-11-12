#!/usr/bin/env python3
"""Validate the generated qBittorrent configuration offline, without acquiring media."""
import json, os, pathlib, re, shutil, subprocess, tempfile, time
base = pathlib.Path('/home/openclaw/media-stack')
root = pathlib.Path(tempfile.mkdtemp(prefix='journal-qbit-probe-'))
name = 'journal-qbit-offline-probe'
image = next(x.split('=', 1)[1] for x in pathlib.Path('ops/media-stack/images.lock').read_text().splitlines() if x.startswith('QBITTORRENT_IMAGE='))
shutil.copytree(base / 'services/qbittorrent', root / 'config')
os.chmod(root, 0o755)
(root / 'data').mkdir()
for item in root.rglob('*'):
    os.chmod(item, 0o777 if item.is_dir() else 0o666)
def docker(*args):
    return subprocess.check_output(['sudo', '-n', 'docker', *args], stderr=subprocess.DEVNULL).decode()
try:
    docker('run', '-d', '--name', name, '--network=none', '-e', 'PUID=1000', '-e', 'PGID=1000', '-v', str(root / 'config') + ':/config', '-v', str(root / 'data') + ':/data', image)
    for attempt in range(30):
        try:
            prefs = json.loads(docker('exec', name, 'curl', '-fsS', 'http://127.0.0.1:8080/api/v2/app/preferences'))
            break
        except Exception:
            time.sleep(1)
    else:
        raise RuntimeError('qBittorrent did not start')
    mode = json.loads((base / 'config.json').read_text()).get('networkMode', 'vpn')
    assert prefs['current_network_interface'] == ('tun0' if mode == 'vpn' else ''), 'Incorrect interface binding'
    assert prefs['web_ui_username'] == 'journal', 'Incorrect username'
    docker('exec', name, 'curl', '-fsS', '-X', 'POST', '-H', 'Referer: http://127.0.0.1:8080/', '--data-urlencode', 'json={"bypass_local_auth":false}', 'http://127.0.0.1:8080/api/v2/app/setPreferences')
    creds = json.loads((base / 'credentials.json').read_text())
    login = docker('exec', name, 'curl', '-ifsS', '-X', 'POST', '-H', 'Referer: http://127.0.0.1:8080/', '--data-urlencode', 'username=journal', '--data-urlencode', 'password=' + creds['password'], 'http://127.0.0.1:8080/api/v2/auth/login')
    assert re.search(r'set-cookie: (?:sid|qbt_sid_[^=;]+)=', login.lower()), 'Configured password was not accepted'
    print('Offline qBittorrent probe passed: password accepted and interface matches ' + mode + ' mode.')
finally:
    subprocess.run(['sudo', '-n', 'docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(['sudo', '-n', 'rm', '-rf', str(root)], check=True)
