import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSiteAnalyticsScript } from '../lib/site-conversion';

type Env = { framed: boolean; search?: string; referrer?: string; seen?: boolean };

/** Runs the script against a fake page; returns what gtag was told and how to move time or act. */
function run(env: Env) {
  const dataLayer: unknown[][] = [];
  const timers: Array<() => void> = [];
  const listeners: Record<string, () => void> = {};
  const self = {};
  const window: any = { dataLayer, self, top: env.framed ? {} : self, name: env.seen ? 'tato-frame-seen' : '' };
  new Function('window', 'document', 'location', 'setTimeout', 'addEventListener', 'dataLayer',
    buildSiteAnalyticsScript(['G-TEST1234', 'AW-123456789']),
  )(
    window,
    { referrer: env.referrer ?? '' },
    { search: env.search ?? '' },
    (fn: () => void) => timers.push(fn),
    (type: string, fn: () => void) => { listeners[type] = fn; },
    dataLayer,
  );
  const configs = () => dataLayer.filter((a) => a[0] === 'config').map((a) => [a[1], a[2]]);
  return { configs, tick: () => timers.forEach((fn) => fn()), act: (type: string) => listeners[type]?.(), window };
}

test('a page opened on its own configures its tags at once', () => {
  const page = run({ framed: false });
  assert.deepEqual(page.configs(), [['G-TEST1234', {}], ['AW-123456789', {}]]);
});

test('back from Stripe, the referrer is ignored', () => {
  const page = run({ framed: false, referrer: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  assert.deepEqual(page.configs()[0], ['G-TEST1234', { ignore_referrer: true }]);
  assert.deepEqual(run({ framed: false, referrer: 'https://stripe.com.evil.io/' }).configs()[0], ['G-TEST1234', {}]);
});

test('a framed first load without ad parameters holds its page_view', () => {
  const page = run({ framed: true });
  assert.deepEqual(page.configs(), [], 'nothing until the visitor acts or time passes');
  page.tick();
  assert.equal(page.configs().length, 2);
  page.act('pointerdown');
  assert.equal(page.configs().length, 2, 'sent once, not again on interaction');
});

test('the visitor acting releases the held page_view early', () => {
  const page = run({ framed: true });
  page.act('scroll');
  assert.equal(page.configs().length, 2);
});

test('the reload that carries the ad parameters reports straight away', () => {
  // The company site swaps the frame's address; the first load already marked the frame as seen.
  assert.equal(run({ framed: true, search: '?utm_source=test&gclid=abc', seen: true }).configs().length, 2);
  // And on a first load that already has them, too.
  assert.equal(run({ framed: true, search: '?gbraid=x' }).configs().length, 2);
});

test('later pages of a framed visit are not held', () => {
  assert.equal(run({ framed: true, seen: true }).configs().length, 2);
});

test('the frame marks itself so its next page is not held', () => {
  const page = run({ framed: true });
  assert.equal(page.window.name, 'tato-frame-seen');
  assert.equal(run({ framed: false }).window.name, '', 'a page on its own leaves window.name alone');
});
