import { test } from 'node:test';
import assert from 'node:assert/strict';
import Blokbay, { BlokbayError, DEFAULT_BASE_URL } from '../src/index.js';

const SK = 'sk_live_' + 'a1'.repeat(24);
const PAYMENT = {
  id: 'gp_k2x9m4q7r1', object: 'payment', status: 'pending', amount: '249.90', currency: 'USD', amount_usd: '249.90', exchange_rate: '1',
  rate_at: null, rate_source: null, rate_kind: null, rate_locked: true, reference: '1001', description: 'Order 1001', customer_email: null,
  url: 'https://blokbay.com/pay/gp_k2x9m4q7r1', test: false, link: null, network: null, coin: null, tx: null, transactions: [],
  created_at: '2026-11-22T10:00:00.000Z', expires_at: '2026-11-23T10:00:00.000Z', paid_at: null,
};

// Mock fetch: records calls, answers from a queue of [status, body, headers].
function mock(...answers) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const a = answers.length > 1 ? answers.shift() : answers[0];
    if (a instanceof Error) throw a;
    const [status, body, headers = {}] = a;
    return new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  };
  f.calls = calls;
  return f;
}

test('constructor checks the secret key', () => {
  assert.throws(() => new Blokbay(), TypeError);
  assert.throws(() => new Blokbay('pk_live_abc'), TypeError);
  const c = new Blokbay(SK, { fetch: mock([200, {}]) });
  assert.equal(c.baseUrl, DEFAULT_BASE_URL);
  assert.equal(DEFAULT_BASE_URL, 'https://blokbay.com/api/v1');
  assert.ok(!JSON.stringify(c).includes(SK), 'the key is not enumerable');
});

test('payments.create sends the documented fields, Bearer key and Idempotency-Key', async () => {
  const f = mock([201, PAYMENT]);
  const c = new Blokbay(SK, { fetch: f, baseUrl: 'https://blokbay.com/api/v1/' });
  const p = await c.payments.create({
    amount: '249.90', currency: 'USD', reference: '1001', description: 'Order 1001', customer_email: 'buyer@example.com',
    url_success: 'https://shop.example.com/thank-you', url_cancel: 'https://shop.example.com/cart', idempotencyKey: 'order-1001',
  });
  assert.equal(p.id, 'gp_k2x9m4q7r1');
  assert.equal(p.lastResponse.status, 201);
  assert.equal(p.lastResponse.idempotentReplayed, false);
  assert.ok(!Object.keys(p).includes('lastResponse'));
  const [call] = f.calls;
  assert.equal(call.url, 'https://blokbay.com/api/v1/payments');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.headers.authorization, `Bearer ${SK}`);
  assert.equal(call.headers['content-type'], 'application/json');
  assert.equal(call.headers['idempotency-key'], 'order-1001');
  assert.match(call.headers['user-agent'], /^blokbay-node\/1\.0\.0$/);
  assert.equal(call.headers.origin, undefined, 'never an Origin header (the API refuses browser requests)');
  assert.deepEqual(call.body, {
    amount: '249.90', currency: 'USD', reference: '1001', description: 'Order 1001', customer_email: 'buyer@example.com',
    url_success: 'https://shop.example.com/thank-you', url_cancel: 'https://shop.example.com/cart',
  });
});

test('success_url and cancel_url are mapped to url_success and url_cancel', async () => {
  const f = mock([201, PAYMENT]);
  await new Blokbay(SK, { fetch: f }).payments.create({ amount: 10, success_url: 'https://a.example/ok', cancel_url: 'https://a.example/no' });
  assert.deepEqual(f.calls[0].body, { amount: 10, url_success: 'https://a.example/ok', url_cancel: 'https://a.example/no' });
  assert.equal(f.calls[0].headers['idempotency-key'], undefined);
});

test('payments.create requires amount', () => {
  const c = new Blokbay(SK, { fetch: mock([201, PAYMENT]) });
  assert.throws(() => c.payments.create({ reference: 'x' }), TypeError);
});

test('idempotent replay is reported', async () => {
  const f = mock([200, PAYMENT, { 'idempotent-replayed': 'true' }]);
  const p = await new Blokbay(SK, { fetch: f }).payments.create({ amount: '249.90', idempotencyKey: 'order-1001' });
  assert.equal(p.lastResponse.status, 200);
  assert.equal(p.lastResponse.idempotentReplayed, true);
});

test('payments.retrieve and payments.list', async () => {
  const f = mock([200, { ...PAYMENT, status: 'paid' }], [200, { object: 'list', data: [PAYMENT] }]);
  const c = new Blokbay(SK, { fetch: f });
  const p = await c.payments.retrieve('gp_k2x9m4q7r1');
  assert.equal(p.status, 'paid');
  assert.equal(f.calls[0].url, 'https://blokbay.com/api/v1/payments/gp_k2x9m4q7r1');
  assert.equal(f.calls[0].init.method, 'GET');
  assert.equal(f.calls[0].init.body, undefined);
  const l = await c.payments.list({ reference: 'order 1001', limit: 5 });
  assert.equal(l.object, 'list');
  assert.equal(l.data.length, 1);
  assert.equal(f.calls[1].url, 'https://blokbay.com/api/v1/payments?reference=order+1001&limit=5');
  assert.throws(() => c.payments.retrieve(''), TypeError);
});

test('payments.list without filters', async () => {
  const f = mock([200, { object: 'list', data: [] }]);
  await new Blokbay(SK, { fetch: f }).payments.list();
  assert.equal(f.calls[0].url, 'https://blokbay.com/api/v1/payments');
});

test('API errors become BlokbayError with code, status and message', async () => {
  const c = new Blokbay(SK, { fetch: mock([400, { error: 'amount', message: 'amount must be a USD amount with at most 2 decimals, from 1.00.' }]) });
  await assert.rejects(c.payments.create({ amount: '0.5' }), (e) => {
    assert.ok(e instanceof BlokbayError);
    assert.equal(e.status, 400); assert.equal(e.code, 'amount');
    assert.match(e.message, /at most 2 decimals/);
    return true;
  });
  const u = new Blokbay(SK, { fetch: mock([401, { error: 'unauthorized', message: 'Missing or invalid secret key (Authorization: Bearer sk_live_...).' }, { 'www-authenticate': 'Bearer' }]) });
  await assert.rejects(u.payments.retrieve('gp_x'), { code: 'unauthorized', status: 401 });
  const n = new Blokbay(SK, { fetch: mock([404, { error: 'not_found', message: 'Payment not found.' }]) });
  await assert.rejects(n.payments.retrieve('gp_missing'), { code: 'not_found', status: 404 });
  const w = new Blokbay(SK, { fetch: mock([409, { error: 'no_wallet', message: 'Add a wallet in your Blokbay settings to receive payments.' }]) });
  await assert.rejects(w.payments.create({ amount: 5 }), { code: 'no_wallet', status: 409 });
});

test('a POST without Idempotency-Key is never retried', async () => {
  const f = mock([503, { error: 'unavailable', message: 'Payments are not available right now.' }]);
  await assert.rejects(new Blokbay(SK, { fetch: f }).payments.create({ amount: 5 }), { code: 'unavailable', status: 503 });
  assert.equal(f.calls.length, 1);
});

test('GET and POST with Idempotency-Key are retried on 429 with a short Retry-After', async () => {
  const f = mock([429, { error: 'rate_limited', message: 'Too many requests.' }, { 'retry-after': '0' }], [201, PAYMENT]);
  const p = await new Blokbay(SK, { fetch: f }).payments.create({ amount: 5, idempotencyKey: 'k1' });
  assert.equal(p.id, PAYMENT.id);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].headers['idempotency-key'], 'k1');
});

test('a long Retry-After is not waited for', async () => {
  const f = mock([429, { error: 'rate_limited', message: 'Too many failed attempts.' }, { 'retry-after': '600' }]);
  await assert.rejects(new Blokbay(SK, { fetch: f }).payments.retrieve('gp_a'), (e) => e.code === 'rate_limited' && e.retryAfter === 600);
  assert.equal(f.calls.length, 1);
});

test('network errors: retried for GET, then BlokbayError connection_error', async () => {
  const f = mock(new TypeError('fetch failed'));
  await assert.rejects(new Blokbay(SK, { fetch: f, maxRetries: 1 }).payments.retrieve('gp_a'), (e) => e instanceof BlokbayError && e.code === 'connection_error' && e.status === 0);
  assert.equal(f.calls.length, 2);
});

test('timeout gives code timeout', async () => {
  const slow = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(new Blokbay(SK, { fetch: slow, timeout: 20, maxRetries: 0 }).payments.retrieve('gp_a'), { code: 'timeout' });
});

test('non JSON error body', async () => {
  const f = async () => new Response('<html>bad gateway</html>', { status: 502 });
  await assert.rejects(new Blokbay(SK, { fetch: f, maxRetries: 0 }).payments.list(), (e) => e.status === 502 && e.code === 'http_502');
});

test('a 2xx answer that is not JSON is an error (wrong baseUrl)', async () => {
  const f = async () => new Response('<!DOCTYPE html><p>hello</p>', { status: 200 });
  await assert.rejects(new Blokbay(SK, { fetch: f }).payments.list(), (e) => e instanceof BlokbayError && e.code === 'invalid_response' && e.status === 200);
});
