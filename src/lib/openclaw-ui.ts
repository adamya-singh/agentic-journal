// Links into the OpenClaw Control UI. Browser-only: the host comes from the page's own location.

/** The Control UI: same Tailscale host on :18443 when served over https, the local gateway otherwise. */
export function controlUiBase(): string {
  const configured = process.env.NEXT_PUBLIC_OPENCLAW_UI_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const { protocol, hostname } = window.location;
  return protocol === 'https:' ? `https://${hostname}:18443` : `http://${hostname}:18789`;
}

export function openClawChatUrl(sessionKey: string): string {
  return `${controlUiBase()}/chat?session=${encodeURIComponent(sessionKey)}`;
}
