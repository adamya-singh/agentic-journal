# PS4 Jellyfin playback

Configured 2026-10-25. PS4 runs Switchfin 0.9.4 (SFIN00000), connecting to
`http://10.44.44.3:8096` over the dedicated Pi-hosted PS4-Direct network.
Ubuntu USB wlan1 joins at .3; internal Wi-Fi stays on building internet.
Windows can remain off for this playback path. Network switching and the preserved
rpi5-ap recovery configuration are documented in the sibling project
`~/projects/ps4-halo-network/DIRECT-MEDIA.md`.

## Accounts and secrets

Dedicated non-admin `ps4` user can play only the movie/TV libraries. Content
deletion, downloads, Live TV, public sharing and administration are disabled.
Credentials live privately in `/home/openclaw/media-stack/ps4-credentials.json`.
The provisioner `scripts/setup-ps4-user.py` uses the existing private admin
credentials, creates the account only when absent, refuses an unmanaged existing
account, and applies the restricted library policy. It does not print passwords
or access tokens and does not overwrite the Journal stack configuration.

`scripts/configure-switchfin.py` authenticates this user and generates private
`/home/openclaw/media-stack/switchfin-config.json` in the upstream 0.9.4 format.
This is a one-time initial-login helper, not a live settings synchronizer. Never
overwrite a running client's config with it; preserve the client's saved settings.
PS4 settings and access token live at `/data/Switchfin/config.json`; do not commit
or display that file. A private transfer copy remains on Pi under
`/home/rpilite/ps4-client-install/` for recovery.

## Isolation and playback history

Existing Docker Jellyfin remains loopback-only on 127.0.0.1:8096. A dedicated
systemd socket proxy exposes only 10.44.44.3:8096 on the USB interface, with UFW
allowing only Pi 10.44.44.1. PS4's existing Pi masquerade supplies this source.
Arr administration interfaces remain loopback-only. Building-Wi-Fi port 8096
was tested unreachable; existing Journal Tailscale access remains available.

PS4 progress is stored by Jellyfin under user ps4, independently of Journal's
journal-player and Journal progress storage. There is no progress synchronization.
The one-session guard in `jellyfin-playback.ts` reserves only Journal sessions;
it does NOT constrain Switchfin or enforce a global one-stream limit. Use one
player at a time on this laptop to avoid unplanned transcode contention. The
storage guard reaps only Journal-owned sessions, not native client sessions.

## Package and maintenance

Upstream: https://github.com/dragonflylee/switchfin/releases/tag/0.9.4
Package: IV0001-SFIN00000_00-SFIN000000009400.pkg
Installed staging: /data/pkg/Switchfin-0.9.4.pkg (58,458,112 bytes)
SHA256: 2d0dac54eaec7cf9b86a7a169cb9b88409327fc10bff8c10ea42357d4ba3661c
Uploader success, independent FTP size, and full readback hash verified before
installation. Native launch and library browsing verified on the existing console.
No firmware or pairing changes. Installer retained after installation.

An Ubuntu-distributed DejaVu Sans font was added as `/data/Switchfin/subfont.ttf`
for subtitle testing, with independent size/hash verification. Its source is
`/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`; distro license is under
`/usr/share/doc/fonts-dejavu-core/`. The font and package stay outside Git.
See PS4 project's dated history for the final playback/subtitle/transcode results.

## Playback checks, October 25

Native 1080p HEVC/AAC SDR playback was visually verified. Audio-track selection
and seeking were exercised through Remote Play; audible TV output and physical
controller behavior still need user confirmation. English text subtitles appeared
after the DejaVu font was installed and Switchfin fully closed/relaunched. Saved
Continue Watching reopened the episode at its previous position.

Choosing 1.5 Mbps in Video Quality forced Jellyfin VA-API H.264/AAC MPEG-TS HLS
at 1280x720; fresh console images confirmed playback after startup buffering.
The Auto setting had previously direct-played the 1080p source. PS4 quality
choices reflect the source bitrate; an 8 Mbps option need not appear for a
roughly 2 Mbps source. Client session reports may still say DirectPlay during
HLS: use TranscodingInfo plus console pixels to distinguish the actual path.

The old USB adapter disconnected during the initial long test. Scoped Ubuntu
reconnect and Pi stale-station checks were added as described in the network
runbook. A subsequent 20-minute sample check is stored outside Git at
/home/openclaw/.cache/ps4-client/soak-20261025.json; record its final outcome in
PS4 history before calling the setup stable. Remote Play was stopped for this
check. Journal and Arr services remained running and normal internet was retained.


## Final outcome: 2026-10-25

User confirmed that TV audio and video looked good, and confirmed manually
pausing the episode. Final fresh console capture showed paused playback at 20:42
with English captions. Left that state intact and stopped Remote Play/observer.

The renewed observer recorded 28 samples over about 14 minutes. Playback advanced
from 8:31 to 20:42 before the user pause. Two isolated Pi ping probes failed;
there was no missing playback session among successful API samples. Three
observer API failures came from a diagnostics login/token collision, corrected
by giving each diagnostics login its own device ID; these are not counted as
proven media outages. The planned 20-minute uninterrupted test was therefore
not completed. Earlier USB firmware/association failures remain a limitation.

Both normal internet routes and existing Journal/media services were retained.
Windows Sunshine was not running during its initial check; the existing installed
host was started and Pi TCP reachability to 47984/47989/48010 passed. Actual
Moonlight gameplay was not relaunched because the user had paused Switchfin.
No claim that Windows's weak game-stream Wi-Fi has been fixed.
