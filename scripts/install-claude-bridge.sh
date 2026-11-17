#!/usr/bin/env bash
# Puts the Claude Code bridge (bridge/) on one of Adamya's devices, so the Journal can run Claude Code sessions there
# over ssh with that device's own `claude`, login and transcripts (docs/code-sessions-design.md, "Other devices").
#
#   scripts/install-claude-bridge.sh <host>            a proj host (wsl, mac) or an ssh alias (win11, macbook)
#   scripts/install-claude-bridge.sh --local           this machine (see the note on this laptop below)
#   options:
#     --dry-run        say what would be done; change nothing anywhere (no ssh is opened for it)
#     --prefix <dir>   where it goes (default: ~/.local/share/agentic-journal/claude-bridge on the device)
#     --no-service     copy and install only; no user service is written or started
#     --no-start       write the user service but do not (re)start it
#
# What it does on the device, in order:
#   1. checks (read-only): a POSIX login shell, node >= 22.18 (it runs the bridge's TypeScript as is), npm, `claude`,
#      and a user service manager (systemd --user on Linux, launchd on macOS);
#   2. copies bridge/*.ts, its package files and src/lib/code-agents/{protocol,adapter}.ts into <prefix>.new, runs
#      `npm install --omit=optional` there (the SDK without its bundled Claude binary: the device's own `claude` is
#      used; packages are kept from the last install when the lock file is the same), then swaps it into <prefix>;
#   3. writes <prefix>/run, which starts the bridge with the node it was installed with (`run serve`, `run proxy`);
#   4. writes and starts the user service: agentic-journal-claude-bridge (systemd) or
#      com.agentic-journal.claude-bridge (launchd, ~/Library/LaunchAgents). A bridge already running is restarted,
#      which ends its running turns as failed.
#
# Not supported (it says so and stops before changing anything): Windows itself (use its WSL), WSL or Linux without
# systemd --user (enable systemd in /etc/wsl.conf, or run `<prefix>/run serve` yourself), node older than 22.18,
# a device ssh cannot reach without a password (BatchMode), and a login shell that is not bash, zsh or sh.
# Claude Code must be signed in on the device (`claude auth login` there, or Sign in from the Journal once the bridge runs).
#
# This laptop runs its bridge from the repo (systemd/agentic-journal-claude-bridge.service, same service name): use
# --local only with --prefix and --no-service here, or it would replace that unit.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE=agentic-journal-claude-bridge
LAUNCHD_LABEL=com.agentic-journal.claude-bridge
DRY=0; LOCAL=0; SERVICE_ON=1; START=1; PREFIX=""; TARGET=""

die() { echo "install-claude-bridge: $*" >&2; exit 1; }
say() { echo "install-claude-bridge: $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --local) LOCAL=1 ;;
    --no-service) SERVICE_ON=0 ;;
    --no-start) START=0 ;;
    --prefix) [ $# -ge 2 ] || die "--prefix needs a folder"; PREFIX="$2"; shift ;;
    -h|--help) sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option $1 (see --help)" ;;
    *) [ -z "$TARGET" ] || die "one device at a time"; TARGET="$1" ;;
  esac
  shift
done
[ "$LOCAL" = 1 ] || [ -n "$TARGET" ] || die "say which device (a proj host or an ssh alias), or --local (see --help)"
[ "$LOCAL" = 1 ] && [ -n "$TARGET" ] && die "--local or a device, not both"
case "$PREFIX" in *"'"*|*'"'*|*'$'*|*'`'*|*'\'*) die "--prefix must not hold quotes, \$, \` or \\" ;; esac

# The device's ssh name: a proj host's alias from the registry (registry.json hosts.<host>.alias), else as given.
ALIAS="$TARGET"
if [ -n "$TARGET" ]; then
  REG="${PROJ_REGISTRY_DIR:-$HOME/projects/projects-index}/registry.json"
  if [ -f "$REG" ]; then
    FOUND="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const h=(r.hosts||{})[process.argv[2]];process.stdout.write(h&&typeof h.alias==="string"?h.alias:"")' "$REG" "$TARGET" 2>/dev/null || true)"
    [ -n "$FOUND" ] && ALIAS="$FOUND"
  fi
  printf '%s' "$ALIAS" | grep -Eq '^([A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9._-]*$' || die "\"$ALIAS\" is not an ssh name this script will use"
fi
WHERE="${TARGET:-this machine}"
[ "$ALIAS" != "$TARGET" ] && WHERE="$TARGET (ssh $ALIAS)"

SSH_OPTS=(-T -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15)
# Runs a script on the device in its login shell (so it finds node, npm and claude as his terminal does).
on_device() {
  if [ "$LOCAL" = 1 ]; then "${SHELL:-/bin/sh}" -l -s; else ssh "${SSH_OPTS[@]}" -- "$ALIAS" 'exec "${SHELL:-/bin/sh}" -l -s'; fi
}

FILES=(bridge/claude-bridge.ts bridge/mapping.ts bridge/sdk-types.ts bridge/server.ts bridge/sessions.ts bridge/package.json bridge/package-lock.json bridge/.gitignore
       src/lib/code-agents/protocol.ts src/lib/code-agents/adapter.ts)
for f in "${FILES[@]}"; do [ -f "$REPO/$f" ] || die "missing $f in $REPO"; done
# The device's own bridge must speak the protocol this Journal speaks.
PROTOCOL="$(sed -n 's/^export const BRIDGE_PROTOCOL = \([0-9]*\);.*/\1/p' "$REPO/bridge/sessions.ts")"

# The folder there, as the device's shell will read it (its own XDG_DATA_HOME and HOME).
if [ -n "$PREFIX" ]; then DEST_EXPR="$PREFIX"; else DEST_EXPR='${XDG_DATA_HOME:-$HOME/.local/share}/agentic-journal/claude-bridge'; fi

if [ "$DRY" = 1 ]; then
  say "dry run for $WHERE: nothing is changed and no ssh is opened."
  say "1. check there: a POSIX login shell, node >= 22.18, npm, claude, $( [ "$SERVICE_ON" = 1 ] && echo 'systemd --user or launchd' || echo 'no service manager needed (--no-service)')"
  say "2. copy ${#FILES[@]} files (bridge protocol $PROTOCOL) to $DEST_EXPR.new, npm install --omit=optional there, swap it into $DEST_EXPR"
  say "3. write $DEST_EXPR/run (node … bridge/claude-bridge.ts serve|proxy)"
  if [ "$SERVICE_ON" = 1 ]; then
    say "4. write the user service ($SERVICE on Linux, $LAUNCHD_LABEL on macOS)$( [ "$START" = 1 ] && echo ' and (re)start it' || echo ', not started (--no-start)')"
  fi
  exit 0
fi

# ---- 1. Checks, read-only. The script below prints "ok …" lines or "fail …" and changes nothing.
CHECK="$(on_device <<EOF || true
set -u
fail() { echo "fail \$*"; exit 0; }
case "\$(uname -s 2>/dev/null)" in
  Linux) os=linux ;;
  Darwin) os=mac ;;
  *) fail "this is not Linux or macOS (\$(uname -s 2>/dev/null)). On Windows, install into its WSL instead." ;;
esac
node="\$(command -v node || true)"; [ -n "\$node" ] || fail "node is not installed (or not on the login shell's PATH). The bridge needs node 22.18 or newer."
case "\$node" in /mnt/[a-z]/*) fail "the node found is Windows' (\$node). Install node in WSL itself (22.18 or newer)." ;; esac
v="\$("\$node" -p 'process.versions.node' 2>/dev/null || echo 0)"
major="\${v%%.*}"; rest="\${v#*.}"; minor="\${rest%%.*}"
if [ "\$major" -lt 22 ] || { [ "\$major" -eq 22 ] && [ "\$minor" -lt 18 ]; }; then fail "node \$v is too old: the bridge needs 22.18 or newer (it runs TypeScript as is)."; fi
npm="\$(command -v npm || true)"; [ -n "\$npm" ] || fail "npm is not installed."
case "\$npm" in /mnt/[a-z]/*) fail "the npm found is Windows' (\$npm). Install node and npm in WSL itself." ;; esac
claude="\$(command -v claude || true)"; [ -n "\$claude" ] || fail "Claude Code (claude) is not installed there."
if [ "$SERVICE_ON" = 1 ]; then
  if [ "\$os" = linux ]; then
    state="\$(systemctl --user is-system-running 2>/dev/null || true)"
    case "\$state" in running|degraded|starting) ;; *) fail "there is no systemd --user here (\${state:-none}). On WSL, enable systemd in /etc/wsl.conf ([boot] systemd=true) and restart WSL, or pass --no-service and run the bridge yourself." ;; esac
  else
    command -v launchctl >/dev/null 2>&1 || fail "launchctl is not there."
  fi
fi
echo "ok os=\$os node=\$node v=\$v claude=\$claude path=\$(dirname "\$node"):\$(dirname "\$claude")"
EOF
)"
LINE="$(printf '%s\n' "$CHECK" | grep -E '^(ok|fail) ' | tail -n 1 || true)"
case "$LINE" in
  ok\ *) say "checks passed on $WHERE: ${LINE#ok }" ;;
  fail\ *) die "not installed on $WHERE: ${LINE#fail }" ;;
  *) die "could not check $WHERE$( [ "$LOCAL" = 1 ] || echo " over ssh (is key login to $ALIAS set up? ssh never asks for a password here)"): ${CHECK:-no answer}" ;;
esac
DEV_OS="$(printf '%s' "$LINE" | sed -n 's/.* os=\([a-z]*\) .*/\1/p')"

# ---- 2. Copy, npm install, swap.
say "copying the bridge to $WHERE"
if [ "$LOCAL" = 1 ]; then
  tar -C "$REPO" -cf - "${FILES[@]}" | "${SHELL:-/bin/sh}" -l -c "d=\"$DEST_EXPR\"; rm -rf \"\$d.new\" && mkdir -p \"\$d.new\" && tar -xf - -C \"\$d.new\""
else
  tar -C "$REPO" -cf - "${FILES[@]}" | ssh "${SSH_OPTS[@]}" -- "$ALIAS" "d=\"$DEST_EXPR\"; rm -rf \"\$d.new\" && mkdir -p \"\$d.new\" && tar -xf - -C \"\$d.new\""
fi

INSTALL_RESULT="$(on_device <<EOF
set -eu
d="$DEST_EXPR"
umask 077
printf '{\n  "private": true,\n  "type": "module",\n  "description": "The Agentic Journal Claude bridge, as scripts/install-claude-bridge.sh put it here."\n}\n' > "\$d.new/package.json"
# Packages from the last install are kept when the lock file is the same (no network needed then).
if [ -d "\$d/bridge/node_modules" ] && cmp -s "\$d/bridge/package-lock.json" "\$d.new/bridge/package-lock.json"; then
  cp -R "\$d/bridge/node_modules" "\$d.new/bridge/node_modules"
else
  (cd "\$d.new/bridge" && npm install --omit=optional --no-audit --no-fund >/dev/null 2>"\$d.new/npm.log") || { echo "npm install failed: \$(tail -n 3 "\$d.new/npm.log" | tr '\n' ' ')"; exit 1; }
fi
node="\$(command -v node)"
cat > "\$d.new/run" <<RUN
#!/bin/sh
# Starts the Agentic Journal's Claude bridge: run serve | run proxy [--socket <path>].
here="\\\$(cd "\\\$(dirname "\\\$0")" && pwd)"
exec "\$node" --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "\\\$here/bridge/claude-bridge.ts" "\\\$@"
RUN
chmod 700 "\$d.new/run"
rm -rf "\$d.old"
[ -d "\$d" ] && mv "\$d" "\$d.old"
mv "\$d.new" "\$d"
rm -rf "\$d.old"
rm -f "\$d/npm.log"
echo "installed \$d"
EOF
)" || die "install failed on $WHERE: $INSTALL_RESULT"
say "$INSTALL_RESULT"

if [ "$SERVICE_ON" = 0 ]; then
  say "no service written (--no-service). Start it there with: $DEST_EXPR/run serve"
  exit 0
fi

# ---- 4. The user service.
SVC_PATH="$(printf '%s' "$LINE" | sed -n 's/.* path=\(.*\)$/\1/p')"
CLAUDE_BIN="$(printf '%s' "$LINE" | sed -n 's/.* claude=\([^ ]*\) .*/\1/p')"
if [ "$DEV_OS" = linux ]; then
  RESULT="$(on_device <<EOF
set -eu
d="$DEST_EXPR"
unit="\${XDG_CONFIG_HOME:-\$HOME/.config}/systemd/user/$SERVICE.service"
mkdir -p "\$(dirname "\$unit")"
cat > "\$unit" <<UNIT
# Written by the Agentic Journal's scripts/install-claude-bridge.sh. Runs its Claude Code bridge on this device.
[Unit]
Description=Agentic Journal: Claude Code bridge (runs Claude Code sessions for the task workspace)
After=default.target

[Service]
Type=simple
WorkingDirectory=\$HOME
Environment=PATH=$SVC_PATH:\$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=CLAUDE_CLI_PATH=$CLAUDE_BIN
Environment=NODE_ENV=production
EnvironmentFile=-\${XDG_CONFIG_HOME:-\$HOME/.config}/agentic-journal/claude-bridge.env
ExecStart=\$d/run serve
Restart=on-failure
RestartSec=5
KillMode=mixed
TimeoutStopSec=30
UMask=0077

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable "$SERVICE" >/dev/null 2>&1
if [ "$START" = 1 ]; then systemctl --user restart "$SERVICE"; sleep 2; echo "service \$(systemctl --user is-active "$SERVICE" 2>&1)"; else echo "service written, not started"; fi
EOF
)" || die "the service could not be set up on $WHERE: $RESULT"
else
  RESULT="$(on_device <<EOF
set -eu
d="$DEST_EXPR"
plist="\$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist"
mkdir -p "\$HOME/Library/LaunchAgents" "\$HOME/Library/Logs"
cat > "\$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LAUNCHD_LABEL</string>
  <key>ProgramArguments</key><array><string>\$d/run</string><string>serve</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$SVC_PATH:\$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>CLAUDE_CLI_PATH</key><string>$CLAUDE_BIN</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>Umask</key><integer>63</integer>
  <key>StandardErrorPath</key><string>\$HOME/Library/Logs/agentic-journal-claude-bridge.log</string>
</dict></plist>
PLIST
if [ "$START" = 1 ]; then
  launchctl bootout "gui/\$(id -u)/$LAUNCHD_LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/\$(id -u)" "\$plist"
  echo "service loaded"
else
  echo "service written, not loaded"
fi
EOF
)" || die "the service could not be set up on $WHERE: $RESULT"
fi
say "$RESULT"
say "done. Claude Code must be signed in on $WHERE: run \`claude auth login\` there, or press Sign in in the Journal's new-chat form."
