import { pathToFileURL } from 'node:url';

// Project the website's authenticated response without exposing unrelated facts.
export function extractSimplifyExperiences(profile) {
  if (!Array.isArray(profile.experience)) throw new Error('Simplify experience unavailable');
  return profile.experience.map((e) => ({
    experienceId: e.id, employer: e.company?.name, title: e.title,
    startMonth: e.start_month, startYear: e.start_year,
    endMonth: e.end_month, endYear: e.end_year, currentlyWorking: e.currently_working,
  }));
}

// Observe the website's own authenticated profile request. No cookies or tokens
// are extracted, persisted, or printed. Use a separate tab to avoid worker tabs.
export async function captureExperiences() {
  const version = await (await fetch('http://127.0.0.1:18800/json/version')).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0, target;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
    else for (const listener of listeners) listener(message);
  });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const n = ++id;
    const timeout = setTimeout(() => { pending.delete(n); reject(new Error('Browser request timed out')); }, 15000);
    pending.set(n, (message) => { clearTimeout(timeout); message.error ? reject(new Error(message.error.message)) : resolve(message.result); });
    ws.send(JSON.stringify({ id: n, method, params, sessionId }));
  });
  try {
    target = (await call('Target.createTarget', { url: 'about:blank' })).targetId;
    const { sessionId } = await call('Target.attachToTarget', { targetId: target, flatten: true });
    await call('Network.enable', {}, sessionId);
    const profile = new Promise((resolve, reject) => {
      let requestId;
      const timeout = setTimeout(() => reject(new Error('Simplify profile unavailable; sign in or retry')), 20000);
      listeners.add(async (event) => {
        if (event.sessionId !== sessionId) return;
        if (event.method === 'Network.responseReceived'
            && /^https:\/\/api\.simplify\.jobs\/v2\/candidate\/me\/?(?:\?|$)/.test(event.params.response.url)) {
          if (event.params.response.status !== 200) {
            clearTimeout(timeout); reject(new Error('Simplify profile unavailable')); return;
          }
          requestId = event.params.requestId;
        }
        if (requestId && event.method === 'Network.loadingFinished' && event.params.requestId === requestId) {
          clearTimeout(timeout);
          try {
            const response = await call('Network.getResponseBody', { requestId }, sessionId);
            const body = response.base64Encoded ? Buffer.from(response.body, 'base64').toString() : response.body;
            resolve(extractSimplifyExperiences(JSON.parse(body)));
          } catch (error) { reject(error); }
        }
      });
    });
    await call('Page.navigate', { url: 'https://simplify.jobs/profile' }, sessionId);
    return await profile;
  } finally {
    if (target) await call('Target.closeTarget', { targetId: target });
    ws.close();
  }
}

export function resolveDate(experiences, { employer, title, field, attemptCount }) {
  const normalize = (s) => typeof s === 'string'
    ? s.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ') : '';
  if (!normalize(employer) || !normalize(title) || !['start', 'end'].includes(field)
      || !Number.isInteger(attemptCount) || attemptCount < 1) throw new Error('Invalid date request');
  const matches = experiences.filter((e) => normalize(e.employer) === normalize(employer)
    && normalize(e.title) === normalize(title));
  if (matches.length !== 1) throw new Error('Employment match missing or ambiguous');
  const e = matches[0];
  if (typeof e.experienceId !== 'string' || !e.experienceId.trim()) throw new Error('Missing experience ID');
  const month = e[`${field}Month`], year = e[`${field}Year`];
  let value;
  if (field === 'end' && e.currentlyWorking === true) value = 'present';
  else {
    if (field === 'end' && e.currentlyWorking !== false) throw new Error('Unknown employment status');
    if (!Number.isInteger(month) || month < 1 || month > 12
        || !Number.isInteger(year) || year < 1000 || year > 9999) throw new Error('Missing or invalid date');
    value = `${year}-${String(month).padStart(2, '0')}`;
  }
  return { experienceId: e.experienceId, field, value, attemptCount };
}

export function formatDate(source, format = 'YYYY-MM') {
  if (!['YYYY-MM', 'MM/YYYY'].includes(format)) throw new Error('Unsupported date precision or format');
  if (source.value === 'present') return 'Present';
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(source.value)) throw new Error('Invalid source date');
  return format === 'YYYY-MM' ? source.value : `${source.value.slice(5)}/${source.value.slice(0, 4)}`;
}

export function verifyReadback(source, value) {
  if (typeof value !== 'string') throw new Error('Missing date readback');
  const text = value.trim();
  if (text !== formatDate(source) && text !== formatDate(source, 'MM/YYYY')
      && !(source.value === 'present' && text.toLowerCase() === 'present')) {
    throw new Error('Date readback conflicts with Simplify');
  }
  return true;
}

// Worker interface: capture fresh browser data, or process JSON on stdin.
// resolve: {experiences, employer, title, field, attemptCount, format?}
// verify: {source, value}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const command = process.argv[2];
    if (command === 'capture') console.log(JSON.stringify(await captureExperiences()));
    else {
      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input);
      if (command === 'resolve') {
        const dateSource = resolveDate(data.experiences, data);
        console.log(JSON.stringify({ dateSource, answer: formatDate(dateSource, data.format) }));
      } else if (command === 'verify') {
        console.log(JSON.stringify({ verified: verifyReadback(data.source, data.value) }));
      } else throw new Error('Use capture, resolve, or verify');
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
