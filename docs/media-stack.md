# Media downloads and streaming

Journal selects titles and seasons, Sonarr/Radarr acquire and organize files, and Jellyfin streams them inside `/media/unwind/watch`. Only explicitly selected IMDb movies and series are acquired. YouTube and X continue using their existing players.

The private configuration is `/home/openclaw/media-stack/config.json`; generated administration passwords live in `/home/openclaw/media-stack/credentials.json`. Neither is inside the repository. The initial media root is `/home/openclaw/media-stack/data`. The limit is 150 GiB with 50 GiB free-space headroom, two concurrent downloads, and one playback session. Original/default audio and English subtitles are preferred. The Journal quality profile allows 720p and 1080p, prefers 1080p, rejects releases labeled HDR/Dolby Vision, excludes remux qualities, and disables automatic upgrades. Unlabeled media cannot be guaranteed SDR or original-language audio; the player offers audio selection.

## Initial setup

Requires Node 24, Docker Engine and Compose v2, ffmpeg, rsync, and passwordless sudo for the host setup commands. Docker ports are loopback-only. Do not expose them publicly.

```bash
npm run media:stack -- init
npm run media:stack -- up
npm run media:stack -- provision
bash scripts/install-media-stack.sh
```

`init` refuses to overwrite existing configuration. The checked-in `ops/media-stack/images.lock` pins exact image digests. `up` creates an 8 GiB loop-backed ext4 transcode cache on the internal drive, verifies the storage marker, and starts the services. In default VPN mode, without Proton credentials, only Sonarr, Radarr, Prowlarr, and Jellyfin start. The acquisition feature remains in setup mode. `provision` is repeatable and configures quality profiles, hardlinks, private administration accounts, Prowlarr application synchronization, Jellyfin libraries, and a non-admin playback account.

Administration URLs on this laptop: Sonarr `http://127.0.0.1:8989`, Radarr `http://127.0.0.1:7878`, Prowlarr `http://127.0.0.1:9696`, Jellyfin `http://127.0.0.1:8096`, qBittorrent `http://127.0.0.1:8080`. Use SSH local forwarding to reach these from another device, for example `ssh -N -L 9696:127.0.0.1:9696 ubuntu-laptop`. Read the generated credentials file locally; avoid copying credentials into chat or logs. Sonarr/Radarr/Prowlarr/qBittorrent use the `journal` username, Jellyfin administration uses `journal-admin`.

## Direct internet mode

To run without a VPN:

```bash
npm run media:stack -- mode direct
```

This pauses acquisition, stops the downloader before changing its interface and DNS, starts qBittorrent on the normal Docker network, removes Journal's Gluetun proxy from Prowlarr, and updates both managers to reach qBittorrent directly. No Proton subscription or configuration is required in direct mode. The Media panel labels this **Direct internet · VPN off**. Storage admission, paused additions, explicit selection, and the two-download limit still apply. Administration ports remain on loopback, and router UPnP stays disabled.

Add and test download sources in Prowlarr, confirm they sync to both managers, then run `npm run media:stack -- enable`. Without configured sources, requests stay paused regardless of network mode. Peer connectivity may be limited by the apartment network's NAT and firewall; direct mode does not create inbound router port forwarding.

To switch back later, import the Proton configuration, then run `npm run media:stack -- mode vpn`. The VPN override restores the shared Gluetun network namespace, local VPN DNS resolver, `tun0` binding, and source proxy requirements. Run `verify-vpn` and `enable` after its checks pass. Merely saving a Proton file does not change the selected mode.

## Connect Proton and sources

1. Subscribe to **Proton VPN Plus**. It includes the port-forwarding feature; Proton Unlimited is optional for its other products.
2. Generate a WireGuard configuration for a P2P server with **NAT-PMP (Port Forwarding) enabled** and **Moderate NAT disabled**. Save it privately on the laptop, then import its absolute path:

   ```bash
   npm run media:stack -- import-proton /absolute/private/path/proton.conf
   npm run media:stack -- up
   npm run media:stack -- provision
   ```

3. In Prowlarr, add and test sources you have permission to use. Set each source's tag to `journal-vpn`. Run `provision` again to apply the Gluetun proxy/tag to existing sources and connect the paused qBittorrent download clients. Prowlarr synchronizes sources into Sonarr/Radarr. New sources must also carry the proxy tag; health checks reject unproxied sources.
4. Run `npm run media:stack -- verify-vpn` to check VPN egress, DNS configuration, tunnel failure, forwarding renewal, and container recreation before enabling real acquisition. This intentionally restarts the VPN containers and leaves acquisition disabled. In VPN mode, the VPN status service checks Gluetun health and synchronizes qBittorrent's listening port and `tun0` binding every five seconds. If its attestation becomes stale, the guard stops Journal transfers.
5. Enable acquisition only once every live check passes:

   ```bash
   npm run media:stack -- enable
   npm run media:stack -- status
   ```

Choosing media is allowed while setup is pending; it remains wanted until the stack is ready. A TV series always needs explicit seasons. Selecting a season also monitors newly released episodes in that season, while future seasons and specials require their own selection. **Stop keeping** disables monitoring and pauses unfinished downloads; it preserves files. Retry search is explicit. The bulk action accepts only already-selected titles.

Existing manager titles must have the `journal` tag before Journal adopts them. Identity matching uses IMDb IDs, with imported-file paths and Jellyfin provider/episode IDs checked before exposing playback. Ambiguous matches and multi-episode files are held for manual correction in the manager; they are never guessed into watch progress.

## Playback and operation

The `Available` filter and Play buttons refer to imported files indexed by Jellyfin. A season can be partially available while the remaining episodes download. Compatible files stream directly with Range support; incompatible files use HLS remuxing/transcoding. The Journal player supports resume, seeking, audio selection, English subtitles, quality selection, and next-episode navigation. Journal remains authoritative for watch progress and existing IMDb completion behavior.

Jellyfin tokens stay on the server. Short-lived Journal sessions proxy only media resources belonging to the selected item, including rewritten HLS playlists. Playback is private through the Journal's existing Tailscale HTTPS access. Expired sessions are reaped by the storage-guard service, which also ends abandoned transcodes. The original manual-file library worker remains available but skips the managed library to avoid duplicate conversions.

`npm run media:stack -- hardware` performs an offline VA-API encoding probe. Only after it passes does it enable the optional render-device mapping; run `up` and `provision` to activate it. Software transcoding remains the fallback. The AC power service holds a sleep/lid inhibitor on AC and releases it on battery; physical battery/lid transitions should be checked on the laptop.

The admission guard checks every ten seconds. It counts allocated filesystem blocks once per inode, reserves the full remaining size of admitted transfers, starts at most two transfers, and reserves space before admitting payload downloads. Unknown-size magnets first use qBittorrent’s native metadata-only stop condition, one at a time within the two-transfer limit, with 16 MiB reserved for file information. Metadata retrieval stops before downloading payload; interrupted additions are recovered from a private persisted descriptor, and unreachable metadata jobs back off so other jobs can proceed. Completed files are never automatically evicted. Keep third-party writes out of the managed data tree and do not manually start Journal-category torrents outside the guard.

```bash
systemctl status journal-media-stack journal-media-vpn-status journal-media-ac-awake
systemctl status agentic-journal-acquisition-worker agentic-journal-acquisition-guard
journalctl -u agentic-journal-acquisition-worker -n 50
npm run media:stack -- status
```

The normal Journal deployment installs and restarts its acquisition workers. Container and host setup are managed separately with `install-media-stack.sh`. To update images, back up private configurations, run `media:stack -- lock-images`, review the changed digests, run `up`, then run the live smoke test. Retain the previous image lock for rollback. Restart all VPN services together after recreating Gluetun so qBittorrent joins the current network namespace.

## Move media to an external drive

Use a mounted Linux filesystem that supports hardlinks, such as ext4, with an existing empty destination directory owned by `openclaw`. Service databases, credentials, and the bounded transcode cache stay on the internal drive.

```bash
npm run media:stack -- migrate /mnt/media/journal-data
npm run media:stack -- migrate /mnt/media/journal-data --execute
```

The first command previews the operation. Execution stops the media services, copies with `rsync -aH`, verifies checksums and hardlinks, changes the host data-root mapping, and restarts. The source remains available for recovery. Container paths remain `/data`, preserving library identity. If copying or verification fails, services stay stopped and the configuration is unchanged. A missing/mismatched storage marker prevents both managed containers and admission from starting against the wrong drive. Configure the drive's persistent mount before depending on reboot availability.

### Laptop HDD deployment

The WD20EARS HDD (partition UUID `317D75F1159CD40F`) is mounted by `/etc/fstab` at `/mnt/journal-media`, directly over USB 3. Its existing NTFS backup folders are preserved. Journal's separate destination is `/mnt/journal-media/agentic-journal`. Before migration, NTFS3 passed write, permission, atomic-rename, allocated-block accounting, hardlink, and `rsync -aHnc` verification probes. Do not assume those checks apply to another filesystem or mount configuration.

The mount uses `uid=1000,gid=1000,force,acl,nosuid,nodev,noexec,nofail` and a ten-second device timeout. The `force` option enables NTFS3 to automatically mount the volume on boot or reconnect even if an unexpected power loss or USB disconnect marked the journal dirty (preventing manual `ntfsfix` intervention). Host drop-ins named `hdd-mount.conf` for `journal-media-stack`, `agentic-journal-acquisition-worker`, and `agentic-journal-acquisition-guard` require this mount and bind their lifetime to it. Do not unplug the drive while these services are using it. The earlier hub connection failed with USB resets; use the tested direct connection.

#### USB enclosure driver quirk (JMicron JMS578 / AMD xHCI)

The external SATA-to-USB enclosure uses a JMicron JMS578 bridge (`152d:0578`). Under heavy concurrent write bursts (e.g. multi-torrent downloading), the kernel's default `uas` (USB Attached SCSI) driver can experience endpoint queue timeouts that cause the laptop's motherboard AMD Raven xHCI USB 3.1 host controller to hang and crash (`xHCI host controller not responding, assume dead`).

To permanently prevent host controller crashes:
- `/etc/modprobe.d/usb-storage-jmicron.conf` configures `options usb-storage quirks=152d:0578:u` (where `u` = `US_FL_IGNORE_UAS`), forcing the drive onto the standard, synchronous `usb-storage` (Bulk-Only Transport) driver while retaining full USB 3.0 SuperSpeed (5000M) rates.
- The quirk is baked into the host initramfs via `update-initramfs -u` so it applies across reboots.
- If an AMD xHCI host controller ever locks up in hardware, it can be reset without a system reboot by unbinding and rebinding the PCI device:
  ```bash
  echo "0000:04:00.3" | sudo tee /sys/bus/pci/drivers/xhci_hcd/unbind
  sleep 1
  echo "0000:04:00.3" | sudo tee /sys/bus/pci/drivers/xhci_hcd/bind
  ```


The media budget is 1,000 GiB, with 50 GiB minimum free space. Service configuration, databases, credentials, and the transcode cache remain on the internal SSD. Migration preserved the paused acquisition setting; downloads were explicitly resumed by the user after the copy, checksum comparison, hardlink checks, and playback verification passed on October 27, 2026.

The original `/home/openclaw/media-stack/data` is retained for rollback and continues consuming SSD space until a separate verified cleanup. Migration records and private configuration backups are in `/home/openclaw/.cache/media-hdd-migration-20261027/`; do not commit their contents. To roll back before new HDD-only downloads exist, stop the acquisition worker, guard, and media stack; restore the saved `config.before.json` to `/home/openclaw/media-stack/config.json` with mode 0600; then start the stack, guard, and worker. Restoring that configuration also restores the previous 150 GiB budget and paused-download setting. If the HDD is unavailable, remove only these deployment's `hdd-mount.conf` drop-ins and reload systemd before starting against the SSD. Never delete the HDD data as part of rollback.

## Verification

```bash
node --test --import ./scripts/test-register.mjs scripts/media-acquisition.test.ts scripts/media-unwind.test.ts scripts/media-inbox.test.ts
node scripts/media-stack-smoke.ts
python3 scripts/media-stack-qbit-probe.py
```

The live smoke test generates a short video, incompatible-audio variant, and English subtitle locally; adds a temporary Jellyfin library; verifies direct playback, byte-range seeking, subtitles, HLS decoding, and session cleanup; then removes its fixtures. It does not acquire entertainment media. Full VPN/forwarding and real indexer acquisition tests require the user's Proton configuration and configured sources. Test Chrome and Safari controls after deployment; the live smoke test exercises the media protocol with ffmpeg rather than automating those browsers.

PS4 native playback over PS4-Direct is documented in [PS4 playback](ps4-playback.md).
