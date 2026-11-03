export function configureQbitRouting(text: string, mode: 'vpn' | 'direct') {
  const updates: Record<string, Record<string, string>> = {
    BitTorrent: {
      'Session\\Interface': mode === 'vpn' ? 'tun0' : '',
      'Session\\InterfaceName': mode === 'vpn' ? 'tun0' : '',
      'Session\\InterfaceAddress': '',
      'Session\\Port': mode === 'vpn' ? '0' : '6881',
    },
    Preferences: { 'Connection\\UPnP': 'false', 'Connection\\RandomPort': 'false' },
  };
  let lines = text.split(/\r?\n/);
  for (const [section, values] of Object.entries(updates)) {
    let start = lines.findIndex((line) => line.trim() === `[${section}]`);
    if (start < 0) {
      lines.push(`[${section}]`);
      start = lines.length - 1;
    }
    let end = start + 1;
    while (end < lines.length && !lines[end].startsWith('[')) end++;
    const seen = new Set<string>();
    const body = lines.slice(start + 1, end).map((line) => {
      const key = line.split('=', 1)[0];
      if (!(key in values)) return line;
      seen.add(key);
      return `${key}=${values[key]}`;
    });
    for (const [key, value] of Object.entries(values))
      if (!seen.has(key)) body.push(`${key}=${value}`);
    lines = [...lines.slice(0, start + 1), ...body, ...lines.slice(end)];
  }
  return lines.join('\n');
}
