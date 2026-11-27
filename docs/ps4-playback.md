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


## Dropout mitigation: 2026-11-07

Live lag correlated with `wlan1` beacon loss and kernel
`rtw88_8822bu ... failed to get tx report from firmware` messages. The link
failed despite approximately -50 dBm signal. A scoped driver unbind/rebind
failed to restore association; a USBDEVFS_RESET of only the 0bda:b812 Wi-Fi
adapter at USB path 2-2.3 restored association. No host-controller, HDD,
internal Wi-Fi, Jellyfin-container, or PS4 restart was performed.

The saved `ps4-direct-client` profile is now pinned to Pi BSSID
`b8:27:eb:d4:c7:58`, channel 36. NetworkManager documents that BSSID pinning
disables roaming/background scans. The active supplicant network also received
an empty `bgscan` setting without another reconnect. Wi-Fi power saving and
adapter USB autosuspend were already disabled. The private pre-change profile
values are under `/var/lib/ps4-direct-client/lag-repair-20261107-*`.

This is a recovery plus scan mitigation, not proof of a permanent driver fix.
For rollback, clear the profile BSSID and channel using empty values (this
NetworkManager rejects numeric channel 0); activate the profile only when a
playback interruption is acceptable. Do not reload shared rtw88 core/PCI
modules, which also support the internal internet uplink.


## Driver replacement: 2026-11-07

The reset/scan mitigation above did not prevent recurrence. At 16:24:54 EST,
beacon loss/disconnection again coincided with `rtw88_8822bu` firmware TX-report
failure. The stock driver is therefore no longer used for the dedicated adapter.

Installed the separate `88x2bu` vendor driver from
https://github.com/RinCat/RTL88x2BU-Linux-Driver at commit
`465ae7cb522a382adc85ea5c31f228af8d172148`. It supports adapter USB ID
`0bda:b812` and compiled against running kernel `7.0.0-42-generic`. Configuration
is `/etc/modprobe.d/ps4-usb-vendor.conf`: only `rtw88_8822bu` is blacklisted;
`rtw_power_mgnt=0`, `rtw_enusbss=0`, and `rtw_drv_log_level=2` are set for
`88x2bu`. Internal `wlp2s0` retains stock `rtw88_8822be` and its internet route.
The existing MAC-specific systemd link retains the USB interface name `wlan1`.
No shared rtw88 core/PCI module, HDD driver, host controller, or Jellyfin
container was reloaded.

Pinned DKMS source: `/usr/src/rtl88x2bu-20261107.465ae7c`; build parallelism is
limited to two jobs. DKMS build/install passed; the canonical module is
`/lib/modules/7.0.0-42-generic/updates/dkms/88x2bu.ko.zst`. The temporary
manually installed module was removed after DKMS installation. The running
kernel initramfs was regenerated to retain driver selection at boot.
Build and soak evidence is private under
`/home/openclaw/.cache/ps4-client/`.

Rollback: `/usr/local/sbin/ps4-wifi-stock-rollback` unloads only the vendor
module, removes its scoped modprobe configuration, reloads the stock USB driver,
and activates `ps4-direct-client`. This interrupts PS4 streaming. A timed
rollback was armed before activation and canceled after association and packet
checks succeeded. To permanently uninstall, also remove this specific DKMS
version, then run depmod and regenerate the running kernel initramfs.
Do not blacklist the shared core or PCIe modules. A successful short soak is
not a guarantee against every later hardware or network fault.


### USB transport follow-up

The initial vendor-driver USB 3 soak did **not** pass: it lost the link at
16:40:55 and again at 16:43:18 EST, reconnecting in approximately six seconds.
The first recorded 10-minute soak contains one failed three-ping round; do not
report it as a zero-loss success. Playback later advancing does not erase these
failures. The user confirmed one backward playback-position jump was a manual
seek and that playback was smooth at that time.

At 16:44 EST, the vendor driver was reloaded with its supported
`rtw_switch_usb_mode=2` option. `lsusb -t` verified that only the Wi-Fi adapter
moved from the USB 3 bus to USB 2 at 480M; the HDD retained its USB 3 connection.
The MAC-specific interface name, static address, Pi BSSID, and channel remain
unchanged. Follow-up evidence is `usb2-driver-soak-20261107.json` in the private
PS4 cache. Record its final result before calling the transport mitigation
validated.

The documented Pi SSH identity is `rpilite`, with key
`/Users/7adam/.ssh/pppwn-mac-id_rsa` on the Mac, as recorded in an earlier local
Claude session. A search of this Ubuntu laptop did not find that private key.
The Pi accepts SSH connections at 10.44.44.1:22 but rejects the laptop's existing
keys; the Mac also rejects this laptop's current SSH identity. No Pi AP settings
have been changed during this incident. Its PI-Pwn web UI at port 80 is reachable
but does not expose hostapd/kernel diagnostics on its visible pages.


USB 2 validation finished at 16:55:43 EST: the adapter remained associated for
about 11 minutes after the final activation at 16:44:42. No supplicant disconnect
or kernel link-loss/firmware-failure entry appeared after 16:44:45. The dedicated
8-minute observer received all 51 test pings across 17 rounds; playback advanced
491 seconds over 491 seconds of wall time without further manual seeking in
those samples. The USB 2 option was included in a regenerated initramfs, DKMS
reports the pinned driver installed, and the module-alias check selects only the
vendor USB driver. The temporary rollback timers are stopped. This validates
the tested interval, not permanent absence of future faults. Pi hostapd logs
remain uninspected because no usable local SSH identity was found.
