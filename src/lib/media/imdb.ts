import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, type Page, type Browser } from 'playwright-core';
import type { Collection, MediaTitle, Coverage, MediaJob } from './types.ts';

const exec = promisify(execFile);
const base = 'https://www.imdb.com';
export const titleUrl = (id: string) => {
  if (!/^tt\d+$/.test(id)) throw new Error('Invalid IMDb title.');
  return `${base}/title/${id}/`;
};
export class IMDbError extends Error {}
export interface IMDbSession {
  account: { id: string; name: string };
  collection(c: Collection): Promise<{ items: MediaTitle[]; coverage: Coverage }>;
  recommendations(seeds: MediaTitle[]): Promise<MediaTitle[]>;
  enrich?(titles: MediaTitle[]): Promise<MediaTitle[]>;
  change(job: MediaJob): Promise<Partial<MediaTitle>>;
  close(): Promise<void>;
}

export async function connectIMDb(expectedId?: string): Promise<IMDbSession> {
  let browser: Browser | undefined, page: Page | undefined;
  try {
    // Ask OpenClaw for its configured profile, rather than launching a second
    // browser or copying authentication data into Journal.
    const { stdout } = await exec(
      'openclaw',
      ['browser', '--browser-profile', 'openclaw', 'status', '--json'],
      { timeout: 90_000, maxBuffer: 2_000_000 },
    );
    const status = JSON.parse(stdout.slice(stdout.indexOf('{')));
    const endpoint = new URL(status.cdpUrl);
    if (!status.running || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))
      throw new IMDbError('Start the local OpenClaw browser and sign in to IMDb.');
    browser = await chromium.connectOverCDP(endpoint.href, { noDefaults: true, timeout: 15_000 });
    page = await browser.contexts()[0].newPage();
    // Source URLs are present in the DOM/JSON-LD without downloading posters
    // and autoplay media in the worker's dedicated tab.
    await page.route('**/*', (route) =>
      ['image', 'media', 'font'].includes(route.request().resourceType())
        ? route.abort()
        : route.continue(),
    );
    page.setDefaultTimeout(15_000);
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    const menu = page.getByRole('button', { name: 'Toggle account menu', exact: true });
    await menu.waitFor();
    const name = (await menu.innerText()).trim();
    if (!name.toLowerCase().includes((process.env.IMDB_EXPECTED_NAME || 'Adamya').toLowerCase()))
      throw new IMDbError(
        'The OpenClaw browser is signed into another IMDb account. Sign in as Adamya.',
      );
    await menu.click();
    const urls: Partial<Record<Collection, string>> = {};
    for (const [c, label] of [
      ['watched', 'Your watch history'],
      ['ratings', 'Your ratings'],
      ['watchlist', 'Your Watchlist'],
    ] as const) {
      const href = await page
        .getByRole('menuitem', { name: label, exact: true })
        .getAttribute('href');
      if (!href)
        throw new IMDbError('IMDb account navigation changed. OpenClaw needs to review the page.');
      const url = new URL(href, base);
      if (url.origin !== base) throw new IMDbError('Unexpected IMDb account link.');
      urls[c] = url.href;
    }
    // A stable profile ID from the signed-in collection author pins future reads/writes.
    await page.goto(urls.watched!, { waitUntil: 'domcontentloaded' });
    const author = page.getByTestId('list-author-link');
    await author.waitFor();
    const href = await author.getAttribute('href');
    const id = href?.match(/\/user\/([^/]+)\//)?.[1];
    if (!id || (expectedId && expectedId !== id))
      throw new IMDbError('IMDb account changed. Restore the connected account before syncing.');
    return new BrowserIMDb(browser, page, { id, name }, urls);
  } catch (e) {
    if (page) await page.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
    if (e instanceof IMDbError) throw e;
    // Do not surface raw process/browser errors, which can include authentication URLs.
    throw new IMDbError(
      'Could not access IMDb. Check the local OpenClaw browser, login, and any CAPTCHA, then retry.',
    );
  }
}

export class BrowserIMDb implements IMDbSession {
  private browser: Browser;
  private page: Page;
  public account: { id: string; name: string };
  private urls: Partial<Record<Collection, string>>;
  constructor(
    browser: Browser,
    page: Page,
    account: { id: string; name: string },
    urls: Partial<Record<Collection, string>>,
  ) {
    this.browser = browser;
    this.page = page;
    this.account = account;
    this.urls = urls;
  }
  async close() {
    await this.page.close().catch(() => undefined);
    await this.browser.close();
  }
  private async go(url: string) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.page.getByRole('button', { name: 'Toggle account menu', exact: true }).waitFor();
    const name = (
      await this.page.getByRole('button', { name: 'Toggle account menu', exact: true }).innerText()
    ).trim();
    if (name !== this.account.name)
      throw new IMDbError('IMDb account changed during the operation.');
  }
  async collection(c: Collection) {
    await this.go(this.urls[c]!);
    const author = this.page.getByTestId('list-author-link');
    await author.waitFor();
    if (!(await author.getAttribute('href'))?.includes(`/user/${this.account.id}/`))
      throw new IMDbError('IMDb collection belongs to another account.');
    await this.page.waitForFunction(
      () =>
        !!document.querySelector('[data-testid="list-page-mc-total-items"]') ||
        /You haven't rated anything yet\.|This list is empty\./.test(
          document.querySelector('main')?.textContent || '',
        ),
    );
    const count = this.page.getByTestId('list-page-mc-total-items');
    const text = (await count.count()) ? await count.innerText() : '';
    const total = collectionTotal(text, await this.page.locator('main').innerText());
    const items = new Map<string, MediaTitle>();
    let stalled = 0;
    for (let n = 0; n < 200 && total > items.size; n++) {
      const cards = await this.page
        .locator('[data-testid="list-page-mc-list-content"] .ipc-metadata-list-summary-item')
        .evaluateAll(extractCards);
      const before = items.size;
      for (const t of cards) items.set(t.id, t);
      if (items.size >= total) break;
      const more = this.page.getByRole('button', { name: /^(Load|See) more/i }).first();
      if (await more.isVisible()) await more.click();
      else {
        const next = this.page.getByRole('button', { name: /^Next( page)?$/i }).first();
        if ((await next.isVisible()) && (await next.isEnabled())) await next.click();
        else await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      }
      await this.page.waitForTimeout(1000);
      stalled = before === items.size ? stalled + 1 : 0;
      if (stalled >= 3) break;
    }
    return {
      items: [...items.values()],
      coverage: {
        total,
        collected: items.size,
        complete: total === items.size,
        at: new Date().toISOString(),
      },
    };
  }
  async recommendations(seeds: MediaTitle[]) {
    // Native personalized Top Picks are preferred. More Like This provides a
    // useful fallback for accounts with sparse personal ratings.
    await this.go(`${base}/what-to-watch/top-picks/`);
    await this.page.waitForTimeout(2000);
    let cards = await this.page
      .locator('main .ipc-poster-card, main .ipc-metadata-list-summary-item')
      .evaluateAll(extractCards);
    cards = cards.map((t) => ({ ...t, reason: 'IMDb Top Picks for your account' }));
    if (cards.length) return cards.slice(0, 60);
    const results = new Map<string, MediaTitle>();
    const selected = [...seeds]
      .sort((a, b) => (b.yourRating || 0) - (a.yourRating || 0))
      .filter((t) => !t.yourRating || t.yourRating >= 7)
      .slice(0, 4);
    for (const seed of selected) {
      await this.go(titleUrl(seed.id));
      const section = this.page.getByTestId('MoreLikeThis');
      if (!(await section.count())) continue;
      await section.scrollIntoViewIfNeeded();
      const related = await section.locator('.ipc-poster-card').evaluateAll(extractCards);
      for (const t of related)
        if (!results.has(t.id))
          results.set(t.id, {
            ...t,
            reason: seed.yourRating
              ? `Like ${seed.title}, which you rated ${seed.yourRating}/10`
              : `Similar to ${seed.title} in your watch history`,
          });
    }
    return [...results.values()].slice(0, 60);
  }
  async enrich(titles: MediaTitle[]) {
    const enriched: MediaTitle[] = [];
    let failures = 0;
    for (const t of titles) {
      try {
        await this.go(titleUrl(t.id));
        const metadata = await this.page.evaluate(() => {
          const raw = document.querySelector('script[type="application/ld+json"]')?.textContent;
          if (!raw) return null;
          const d = JSON.parse(raw);
          const chips = Array.from(
            document.querySelectorAll('[data-testid="genres"] a, a[href*="/interest/"]'),
          )
            .map((e) => e.textContent?.trim())
            .filter(Boolean);
          return {
            type: d['@type'] as string,
            year: String(d.datePublished || '').slice(0, 4),
            genres: [
              ...new Set([
                ...(Array.isArray(d.genre) ? d.genre : d.genre ? [d.genre] : []),
                ...chips,
              ]),
            ] as string[],
            image: d.image as string | undefined,
          };
        });
        if (metadata)
          enriched.push({
            ...t,
            type: metadata.type,
            year: metadata.year || t.year,
            genres: metadata.genres,
            poster: metadata.image?.startsWith('https://m.media-amazon.com/')
              ? metadata.image.replace(/\._V1_.*$/, '._V1_QL75_UX360_.jpg')
              : t.poster,
          });
      } catch (e) {
        if (e instanceof IMDbError) throw e;
        if (++failures >= 2) break;
      }
    }
    return enriched;
  }
  async change(job: MediaJob): Promise<Partial<MediaTitle>> {
    if (job.action === 'seen' || job.action === 'watchlist') {
      // Title controls initially render unselected until account data hydrates.
      // Check the account collection before touching a toggle, so an already
      // saved title cannot be accidentally removed by an unloaded control.
      const c = job.action === 'seen' ? 'watched' : 'watchlist';
      const current = await this.collection(c);
      if (current.items.some((t) => t.id === job.titleId))
        return job.action === 'seen' ? { watched: true } : { watchlist: true };
      if (!current.coverage.complete)
        throw new IMDbError(
          'IMDb collection is incomplete. Refresh it before retrying this change.',
        );
    }
    await this.go(titleUrl(job.titleId!));
    await this.page.getByTestId(`watched-button-${job.titleId}`).waitFor();
    // Wait for signed-in controls to hydrate before inspecting the saved state.
    await this.page.waitForTimeout(1500);
    const read = () =>
      this.page.evaluate((id) => {
        const watched = document.querySelector(`[data-testid="watched-button-${id}"]`);
        const wl = document.querySelector('[data-testid="tm-box-wl-button"]');
        const rating = document.querySelector('[data-testid="hero-rating-bar__user-rating"]');
        return {
          watched: /^Watched\b/.test(
            watched?.getAttribute('aria-label') || watched?.textContent?.trim() || '',
          ),
          watchlist: wl?.getAttribute('aria-pressed') === 'true',
          yourRating:
            Number(rating?.textContent?.match(/(?:YOUR RATING)\s*(\d+)\s*\/\s*10/i)?.[1]) || null,
        };
      }, job.titleId!);
    let state = await read();
    if (job.action === 'seen' && !state.watched)
      await this.page.getByTestId(`watched-button-${job.titleId}`).click();
    if (job.action === 'watchlist' && !state.watchlist)
      await this.page.getByTestId('tm-box-wl-button').click();
    if (job.action === 'rating' && state.yourRating !== job.rating) {
      await this.page
        .getByTestId('hero-rating-bar__user-rating')
        .first()
        .getByRole('button')
        .click();
      const dialog = this.page.getByRole('dialog');
      await dialog
        .getByRole('button', { name: new RegExp(`^Rate ${job.rating}($| out of 10)`) })
        .click();
      await dialog.getByRole('button', { name: 'Rate', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
    }
    await this.page.waitForTimeout(1000);
    await this.go(titleUrl(job.titleId!));
    await this.page.getByTestId(`watched-button-${job.titleId}`).waitFor();
    await this.page.waitForTimeout(1500);
    state = await read();
    if (
      (job.action === 'seen' && !state.watched) ||
      (job.action === 'watchlist' && !state.watchlist) ||
      (job.action === 'rating' && state.yourRating !== job.rating)
    )
      throw new IMDbError(
        'IMDb did not confirm the change after reload. Check the title before retrying.',
      );
    return state;
  }
}

export function collectionTotal(count: string, main: string) {
  if (/\d/.test(count)) return Number(count.replace(/[^\d]/g, ''));
  if (/You haven't rated anything yet\.|This list is empty\./.test(main)) return 0;
  throw new IMDbError('IMDb collection count is unavailable.');
}

// Executed in the page. Intentionally self-contained and scoped to actual cards.
export function extractCards(elements: Element[]): MediaTitle[] {
  return elements.flatMap((el) => {
    const link = el.querySelector(
      'a.ipc-title-link-wrapper, a.ipc-poster-card__title, a[href*="/title/tt"]',
    );
    const id = link?.getAttribute('href')?.match(/\/title\/(tt\d+)\//)?.[1];
    const title = el
      .querySelector('h3,h4,.ipc-poster-card__title')
      ?.textContent?.trim()
      .replace(/^\d+\.\s*/, '');
    if (!id || !title) return [];
    const meta = el.querySelector('.dli-title-metadata')?.textContent || '';
    const user = el.querySelector('[data-testid="rate-button"], .ratingGroup--user-rating');
    const personal =
      Number(user?.querySelector('.ipc-rating-star--rating')?.textContent) || undefined;
    const rating =
      Number(el.querySelector('.ipc-rating-star--imdb .ipc-rating-star--rating')?.textContent) ||
      undefined;
    const watched = el
      .querySelector('[data-testid^="inline-watched-button"]')
      ?.getAttribute('aria-pressed');
    const watchlist = el
      .querySelector('[aria-label*="Watchlist"][aria-pressed]')
      ?.getAttribute('aria-pressed');
    const image = el.querySelector('img')?.getAttribute('src');
    return [
      {
        id,
        title,
        url: `https://www.imdb.com/title/${id}/`,
        year: meta.match(/(?:19|20)\d{2}(?:[–-]\d{4})?/)?.[0],
        type: /TV Series|TV Mini Series|TV Episode|Movie/.exec(meta)?.[0],
        poster: image?.startsWith('https://m.media-amazon.com/') ? image : undefined,
        imdbRating: rating,
        yourRating: personal,
        watched: watched === null || watched === undefined ? undefined : watched === 'true',
        watchlist: watchlist === null || watchlist === undefined ? undefined : watchlist === 'true',
        collections: [],
      },
    ];
  });
}
