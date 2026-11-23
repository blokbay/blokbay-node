import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Blokbay, { verifyWebhook, constructEvent, signWebhook, parseSignatureHeader, BlokbayError } from '../src/index.js';
import { SERVER_VECTOR as V } from './vectors.js';

const header = `t=${V.t},v1=${V.v1}`;
const now = V.t * 1000;

test('a signature produced by the Blokbay server is accepted', async () => {
  assert.equal(await verifyWebhook(V.body, header, V.secret, { now }), true);
  assert.equal(await Blokbay.verifyWebhook(V.body, header, V.secret, { now: new Date(now) }), true);
  // Same bytes as Buffer, Uint8Array and ArrayBuffer
  const bytes = new TextEncoder().encode(V.body);
  assert.equal(await verifyWebhook(Buffer.from(V.body), header, V.secret, { now }), true);
  assert.equal(await verifyWebhook(bytes, header, V.secret, { now }), true);
  assert.equal(await verifyWebhook(bytes.buffer, header, V.secret, { now }), true);
  // Spaces after the comma, uppercase hex
  assert.equal(await verifyWebhook(V.body, `t=${V.t}, v1=${V.v1.toUpperCase()}`, V.secret, { now }), true);
});

test('the vector matches HMAC-SHA256 of "<t>.<body>" (node:crypto)', () => {
  assert.equal(createHmac('sha256', V.secret).update(`${V.t}.${V.body}`).digest('hex'), V.v1);
});

test('altered signature, body, secret or timestamp are rejected', async () => {
  const flip = V.v1.slice(0, -1) + (V.v1.endsWith('0') ? '1' : '0');
  assert.equal(await verifyWebhook(V.body, `t=${V.t},v1=${flip}`, V.secret, { now }), false);
  assert.equal(await verifyWebhook(V.body.replace('249.90', '249.91'), header, V.secret, { now }), false);
  assert.equal(await verifyWebhook(V.body + ' ', header, V.secret, { now }), false);
  assert.equal(await verifyWebhook(JSON.stringify(JSON.parse(V.body), null, 2), header, V.secret, { now }), false, 're-serialized JSON is not the raw body');
  assert.equal(await verifyWebhook(V.body, header, V.secret.replace('a94d', 'a94e'), { now }), false);
  assert.equal(await verifyWebhook(V.body, `t=${V.t + 1},v1=${V.v1}`, V.secret, { now }), false, 'the timestamp is part of the signature');
});

test('timestamp tolerance (default 300 seconds)', async () => {
  assert.equal(await verifyWebhook(V.body, header, V.secret, { now: now + 300_000 }), true);
  assert.equal(await verifyWebhook(V.body, header, V.secret, { now: now + 301_000 }), false);
  assert.equal(await verifyWebhook(V.body, header, V.secret, { now: now - 301_000 }), false);
  assert.equal(await verifyWebhook(V.body, header, V.secret, { now: now + 3600_000, tolerance: 3600 }), true);
  assert.equal(await verifyWebhook(V.body, header, V.secret), false, 'real clock: the 2026 vector is too old or too new');
});

test('malformed headers and missing secret', async () => {
  for (const h of ['', null, undefined, 'garbage', `v1=${V.v1}`, `t=${V.t}`, `t=abc,v1=${V.v1}`, `t=-${V.t},v1=${V.v1}`, `t=${V.t},v1=xyz`, `t=${V.t}.5,v1=${V.v1}`]) {
    assert.equal(await verifyWebhook(V.body, h, V.secret, { now }), false, String(h));
  }
  assert.equal(await verifyWebhook(V.body, header, '', { now }), false);
  await assert.rejects(verifyWebhook({ not: 'raw' }, header, V.secret, { now }), TypeError);
});

test('parseSignatureHeader', () => {
  assert.deepEqual(parseSignatureHeader(header), { t: String(V.t), v1: V.v1 });
});

test('constructEvent returns the parsed event or throws invalid_signature', async () => {
  const ev = await constructEvent(V.body, header, V.secret, { now });
  assert.equal(ev.type, 'payment.paid');
  assert.equal(ev.account, 'pk_live_0a1b2c3d4e5f60718293a4b5');
  assert.equal(ev.data.status, 'paid');
  assert.equal(ev.data.reference, '1001');
  await assert.rejects(constructEvent(V.body, `t=${V.t},v1=${'0'.repeat(64)}`, V.secret, { now }), (e) => e instanceof BlokbayError && e.code === 'invalid_signature');
});

test('signWebhook produces the same header as the server', async () => {
  assert.equal(await signWebhook(V.body, V.secret, V.t), header);
  const h = await signWebhook('{"id":"evt_x","type":"ping"}', V.secret);
  assert.equal(await verifyWebhook('{"id":"evt_x","type":"ping"}', h, V.secret), true);
});

// When the SDK sits inside the Blokbay repository, check against the live server code too (skipped elsewhere).
const serverPath = fileURLToPath(new URL('../../../src/gateway.js', import.meta.url));
test('cross check with src/gateway.js of the Blokbay server', { skip: !existsSync(serverPath) && 'server code not present' }, async () => {
  const gw = await import(serverPath);
  const secret = await gw.webhookSecret({ GATEWAY_KEY: 'test-gateway-key-0123456789abcdef0123456789' }, 'sh_test', 1);
  assert.equal(secret, V.secret);
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: 'evt_live', type: 'payment.expired', created: ts, account: 'pk_live_x', data: { id: 'gp_live', amount: '1000', currency: 'JPY' } });
  const sig = await gw.signPayload(secret, ts, body);
  assert.equal(await verifyWebhook(body, `t=${ts},v1=${sig}`, secret), true);
  assert.equal(await verifyWebhook(body, `t=${ts},v1=${sig.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'))}`, secret), false);
  // And the server accepts what the SDK signs
  const mine = await signWebhook(body, secret, ts);
  assert.equal(await gw.verifySignature(secret, mine, body), true);
});
