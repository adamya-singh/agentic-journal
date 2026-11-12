// A second redaction pass on the Journal side, the same rules as `proj sessions` uses on each machine. The
// collector already removed secrets before anything left the machine; this catches a digest from an older
// collector or a rule added since.

const RULES: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key]'],
  [/"private_key(?:_id)?"\s*:\s*"[^"]*"/g, '"private_key": "[redacted]"'],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g, '[api key]'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/g, '[github token]'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, '[github token]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[aws key]'],
  [/\bAIza[0-9A-Za-z_-]{35}/g, '[google key]'],
  [/\bya29\.[0-9A-Za-z_-]{20,}/g, '[google token]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[slack token]'],
  [/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, '[telegram token]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[jwt]'],
  [/\b([A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_KEY|COOKIE|SESSION_?ID)[A-Z0-9_]*)(\s*[:=]\s*)["']?[^\s"',;[]{6,}/gi, '$1$2[redacted]'],
  [/\b(authorization|bearer)(\s*[:=]?\s*)(?:bearer\s+)?[A-Za-z0-9._~+/-]{16,}=*/gi, '$1$2[redacted]'],
  [/:\/\/[^/\s:@]+:[^/\s@]+@/g, '://[user]:[redacted]@'],
];
const LONG = /[A-Za-z0-9+/_-]{32,}={0,2}/g;

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) h -= (c / s.length) * Math.log2(c / s.length);
  return h;
}

export function redact(text: string): string {
  let out = text;
  for (const [rx, rep] of RULES) out = out.replace(rx, rep);
  // Random-looking strings (keys, cookies); hex hashes and paths stay.
  return out.replace(LONG, (t) => (/^[0-9a-f]+$/.test(t) || t.includes('/') || entropy(t) < 4.2 ? t : '[secret?]'));
}
