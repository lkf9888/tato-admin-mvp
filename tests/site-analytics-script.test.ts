import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSiteAnalyticsScript } from '../lib/site-conversion';

type Env = { framed: boolean; search?: string; referrer?: string };

/** Runs the script against a fake page; returns what gtag was told and how to move time or act. */
function run(env: Env) {
  const dataLayer: unknown[][] = [];
  const timers: Array<() => void> = [];
  const listeners: Record<string, () => void> = {};
  const self = {};
  const window: any = { dataLayer, self, top: env.framed ? {} : self, name: '' };
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

test('a framed page configures its tags at once, with or without ad parameters', () => {
  // The company site sets the frame's final address once (speedx_auto
  // 44bbc37), so there is no swapped-out first load to hold back.
  assert.equal(run({ framed: true }).configs().length, 2);
  assert.equal(run({ framed: true, search: '?utm_source=test&gclid=abc' }).configs().length, 2);
});

test('the script leaves window.name alone', () => {
  assert.equal(run({ framed: true }).window.name, '');
});
