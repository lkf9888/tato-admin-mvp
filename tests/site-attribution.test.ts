import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendAttribution,
  parseAttribution,
  pickAttribution,
  recallAttribution,
  rememberAttribution,
} from '../lib/site-attribution';

test('keeps only the known ad parameters, with usable values', () => {
  const picked = pickAttribution(
    new URLSearchParams('utm_source=test&utm_medium=cpc&gclid=abc-123&fbclid=x&utm_term=&utm_content=' + 'a'.repeat(201)),
  );
  assert.deepEqual(picked, { gclid: 'abc-123', utm_source: 'test', utm_medium: 'cpc' });
  assert.deepEqual(parseAttribution('{"utm_source":"vanpeople","evil":"x","gbraid":7}'), { utm_source: 'vanpeople' });
  assert.deepEqual(parseAttribution('not json'), {});
  assert.deepEqual(parseAttribution('["utm_source"]'), {});
  assert.deepEqual(parseAttribution(null), {});
  // A lone surrogate is dropped rather than left to throw in encodeURIComponent.
  assert.deepEqual(parseAttribution('{"utm_source":"\\ud800","utm_medium":"cpc"}'), { utm_medium: 'cpc' });
});

test("puts the source on Stripe's success URL without touching its placeholder", () => {
  const url = 'https://rent.speedxrental.com/cars/x?checkout=success&session_id={CHECKOUT_SESSION_ID}';
  assert.equal(
    appendAttribution(url, { utm_source: 'test', utm_campaign: 'fall sale&more', gclid: 'G1' }),
    `${url}&gclid=G1&utm_source=test&utm_campaign=fall%20sale%26more`,
  );
  assert.equal(appendAttribution('https://a.test/p#top', { utm_source: 's' }), 'https://a.test/p?utm_source=s#top');
  assert.equal(appendAttribution(url, {}), url);
});

function fakeWindow(href: string) {
  const store = new Map<string, string>();
  const url = new URL(href);
  (globalThis as any).window = {
    location: { search: url.search, host: url.host, pathname: url.pathname },
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  };
  return {
    store,
    go(next: string) {
      const u = new URL(next);
      Object.assign((globalThis as any).window.location, { search: u.search, host: u.host, pathname: u.pathname });
    },
  };
}

test('the landing page remembers the click, later pages and checkout recall it', () => {
  const page = fakeWindow('https://rent.speedxrental.com/?utm_source=test&gclid=G1');
  const day = 86_400_000;
  rememberAttribution(1_000);
  page.go('https://rent.speedxrental.com/cars/tesla');
  rememberAttribution(2_000); // no parameters: keeps the earlier click
  assert.deepEqual(recallAttribution(3_000), { gclid: 'G1', utm_source: 'test' });
  // A newer click replaces the whole set.
  page.go('https://rent.speedxrental.com/?utm_source=craigslist');
  rememberAttribution(4_000);
  assert.deepEqual(recallAttribution(5_000), { utm_source: 'craigslist' });
  // Thirty days on, the credit has lapsed.
  assert.deepEqual(recallAttribution(4_000 + 31 * day), {});
});

test('sites sharing the platform host keep separate sources', () => {
  const page = fakeWindow('https://app.tatocar.co/s/speedx?utm_source=a');
  rememberAttribution(1);
  page.go('https://app.tatocar.co/s/other/cars/x');
  assert.deepEqual(recallAttribution(2), {});
  page.go('https://app.tatocar.co/s/speedx/zh-CN/cars/y');
  assert.deepEqual(recallAttribution(2), { utm_source: 'a' });
});

test("reopening the thank-you page is not a new click", () => {
  const page = fakeWindow('https://rent.speedxrental.com/?utm_source=newer');
  rememberAttribution(10);
  page.go('https://rent.speedxrental.com/cars/x?checkout=success&session_id=cs_test_1&utm_source=older');
  rememberAttribution(20);
  assert.deepEqual(recallAttribution(30), { utm_source: 'newer' });
});

test('with storage blocked, this visit still checks out with its source', () => {
  const page = fakeWindow('https://blocked.example/?gclid=G2');
  const blocked = () => { throw new Error('SecurityError'); };
  (globalThis as any).window.localStorage = { getItem: blocked, setItem: blocked };
  rememberAttribution(1);
  page.go('https://blocked.example/cars/x');
  assert.deepEqual(recallAttribution(2), { gclid: 'G2' });
});

test('a failed write does not let an older stored click win', () => {
  const page = fakeWindow('https://quota.example/?gclid=old');
  rememberAttribution(1);
  const storage = (globalThis as any).window.localStorage;
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  page.go('https://quota.example/?gclid=new');
  rememberAttribution(2);
  assert.deepEqual(recallAttribution(3), { gclid: 'new' });
});
