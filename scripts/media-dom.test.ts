import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { extractCards, BrowserIMDb } from '../src/lib/media/imdb.ts';
const executablePath = process.env.TEST_CHROME_PATH || '/usr/bin/google-chrome-stable';
test(
  'IMDb cards preserve canonical IDs and distinguish personal from public ratings',
  { skip: !fs.existsSync(executablePath) },
  async () => {
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(`<main><ul>
      <li class="ipc-metadata-list-summary-item"><a href="/title/tt123/?ref_=image">poster</a><a class="ipc-title-link-wrapper" href="/title/tt123/?ref_=title"><h4>1. The Movie</h4></a><div class="dli-title-metadata">2024 Movie</div><span class="ipc-rating-star--imdb"><span class="ipc-rating-star--rating">9.1</span></span><button data-testid="rate-button"><span class="ipc-rating-star--rating">6</span></button><button data-testid="inline-watched-button-tt123" aria-pressed="true">Watched</button></li>
      <li class="ipc-metadata-list-summary-item"><a href="/title/tt456/"><h4>Another Movie</h4></a><button data-testid="rate-button">Rate</button></li>
    </ul><h4>Feedback</h4></main>`);
      const cards = await page.locator('.ipc-metadata-list-summary-item').evaluateAll(extractCards);
      assert.equal(cards.length, 2);
      assert.equal(cards[0].id, 'tt123');
      assert.equal(cards[0].title, 'The Movie');
      assert.equal(cards[0].yourRating, 6);
      assert.equal(cards[0].imdbRating, 9.1);
      assert.equal(cards[0].watched, true);
      assert.equal(cards[1].yourRating, undefined);
    } finally {
      await browser.close();
    }
  },
);
test(
  'browser writes check current state and verify reload for watched, Watchlist and ratings',
  { skip: !fs.existsSync(executablePath) },
  async () => {
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage();
    let watched = false,
      watchlist = false,
      rating: number | null = null,
      clicks = 0,
      save = true;
    await page.exposeFunction('record', (action: string, value?: number) => {
      clicks++;
      if (!save) return;
      if (action === 'seen') watched = true;
      if (action === 'watchlist') watchlist = true;
      if (action === 'rating') {
        rating = value!;
        watched = true;
      }
    });
    await page.route('https://www.imdb.com/title/tt123/', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `<main>
      <button aria-label="Toggle account menu">Adamya</button>
      <button data-testid="watched-button-tt123" aria-label="${watched ? 'Watched' : 'Mark as watched'} A movie" onclick="record('seen')">${watched ? 'Watched' : 'Mark as watched'}</button>
      <button data-testid="tm-box-wl-button" aria-pressed="${watchlist}" onclick="record('watchlist')">Watchlist</button>
      <div data-testid="hero-rating-bar__user-rating">YOUR RATING ${rating ? `${rating}/10` : 'Rate'}<button onclick="document.querySelector('[role=dialog]').hidden=false">Rate A movie</button></div>
      <div role="dialog" hidden><button aria-label="Rate 8" onclick="window.score=8"></button><button onclick="record('rating',window.score);this.parentElement.hidden=true">Rate</button></div>
      </main>`,
      });
    });
    const session = new BrowserIMDb(browser, page, { id: 'owner', name: 'Adamya' }, {});
    session.collection = async (c) => ({
      items: (c === 'watched' ? watched : watchlist)
        ? [
            {
              id: 'tt123',
              title: 'A movie',
              url: 'https://www.imdb.com/title/tt123/',
              collections: [c],
            },
          ]
        : [],
      coverage: { total: 1, collected: 1, complete: true, at: new Date().toISOString() },
    });
    const job = {
      id: 'test',
      titleId: 'tt123',
      status: 'running' as const,
      createdAt: new Date().toISOString(),
    };
    try {
      assert.equal((await session.change({ ...job, action: 'seen' })).watched, true);
      assert.equal(clicks, 1);
      await session.change({ ...job, action: 'seen' });
      assert.equal(clicks, 1, 'already watched must not toggle');
      assert.equal((await session.change({ ...job, action: 'watchlist' })).watchlist, true);
      assert.equal((await session.change({ ...job, action: 'rating', rating: 8 })).yourRating, 8);
      watched = false;
      save = false;
      await assert.rejects(session.change({ ...job, action: 'seen' }), /did not confirm/);
    } finally {
      await session.close();
    }
  },
);
