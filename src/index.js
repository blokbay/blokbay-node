// Blokbay: official client for the Blokbay payments API (https://blokbay.com/docs/api).
// Zero dependencies. Uses only fetch, TextEncoder and Web Crypto, so it runs on Node.js 18+, Deno, Bun and Cloudflare Workers.

// Web Crypto: global in Node 20+, Deno, Bun and Workers; on Node 18 it lives in node:crypto (webcrypto).
let subtleCache;
async function getSubtle() {
  if (subtleCache) return subtleCache;
  if (globalThis.crypto?.subtle) return (subtleCache = globalThis.crypto.subtle);
  try { const m = await import('node:crypto'); subtleCache = m.webcrypto?.subtle || null; } catch { subtleCache = null; }
  return subtleCache;
}

export const VERSION = '1.0.0';
export const DEFAULT_BASE_URL = 'https://blokbay.com/api/v1';
/** Default webhook timestamp tolerance in seconds (same as the Blokbay plugins). */
export const DEFAULT_TOLERANCE = 300;

const enc = new TextEncoder();

/** Error returned by the API ({"error":"code","message":"..."}) or raised for a network problem. */
export class BlokbayError extends Error {
  constructor(message, { status = 0, code = 'connection_error', retryAfter = null, headers = null, body = null, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'BlokbayError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.headers = headers;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Blokbay {
  /**
   * @param {string} secretKey Secret key from the Blokbay dashboard (sk_live_...). Server side only.
   * @param {{ baseUrl?: string, fetch?: typeof fetch, timeout?: number, maxRetries?: number, userAgent?: string }} [options]
   */
  constructor(secretKey, options = {}) {
    if (typeof secretKey !== 'string' || !secretKey.startsWith('sk_')) {
      throw new TypeError('Blokbay: pass your secret key (sk_live_...) from the dashboard, section "Payments on your site".');
    }
    const f = options.fetch || globalThis.fetch;
    if (typeof f !== 'function') throw new TypeError('Blokbay: no fetch available. Use Node.js 18+ or pass options.fetch.');
    Object.defineProperty(this, '_key', { value: secretKey, enumerable: false });
    Object.defineProperty(this, '_fetch', { value: f, enumerable: false });
    this.baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = options.timeout ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.userAgent = options.userAgent || `blokbay-node/${VERSION}`;
    this.payments = new Payments(this);
  }

  /** Low level request. Most code uses client.payments instead. */
  async request(method, path, { body, query, idempotencyKey } = {}) {
    let url = this.baseUrl + path;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) qs.set(k, String(v));
      const s = qs.toString(); if (s) url += '?' + s;
    }
    const headers = { authorization: `Bearer ${this._key}`, accept: 'application/json' };
    // Browsers refuse to set User-Agent; servers (Node, Deno, Bun, Workers) accept it.
    if (typeof window === 'undefined') headers['user-agent'] = this.userAgent;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey !== undefined && idempotencyKey !== null && idempotencyKey !== '') headers['idempotency-key'] = String(idempotencyKey);
    // Retries only when they cannot create a second payment: GET requests, or POST with an Idempotency-Key.
    const safe = method === 'GET' || !!headers['idempotency-key'];
    for (let attempt = 0; ; attempt++) {
      let res;
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl && this.timeout > 0 ? setTimeout(() => ctl.abort(), this.timeout) : null;
      try {
        res = await this._fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl?.signal, redirect: 'manual' });
      } catch (e) {
        if (timer) clearTimeout(timer);
        if (safe && attempt < this.maxRetries) { await sleep(backoff(attempt)); continue; }
        const timeout = e?.name === 'AbortError';
        throw new BlokbayError(timeout ? `Request to Blokbay timed out after ${this.timeout} ms.` : `Could not reach Blokbay: ${e?.message || e}`, { code: timeout ? 'timeout' : 'connection_error', cause: e });
      }
      let text = '';
      try { text = await res.text(); } finally { if (timer) clearTimeout(timer); }
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (res.ok && (data === null || typeof data !== 'object')) {
        throw new BlokbayError(`Unexpected response from Blokbay (HTTP ${res.status}, not JSON). Check baseUrl.`, { status: res.status, code: 'invalid_response', headers: res.headers });
      }
      if (res.ok) {
        if (data && typeof data === 'object') {
          Object.defineProperty(data, 'lastResponse', { enumerable: false, value: { status: res.status, headers: res.headers, idempotentReplayed: res.headers.get('idempotent-replayed') === 'true' } });
        }
        return data;
      }
      const ra = Number(res.headers.get('retry-after'));
      const retryAfter = Number.isFinite(ra) && ra > 0 ? ra : null;
      const retriable = res.status === 429 || res.status === 503 || res.status >= 500;
      if (safe && retriable && attempt < this.maxRetries && (retryAfter === null || retryAfter <= 10)) {
        await sleep(retryAfter !== null ? retryAfter * 1000 : backoff(attempt)); continue;
      }
      const code = (data && typeof data.error === 'string') ? data.error : `http_${res.status}`;
      const message = (data && typeof data.message === 'string') ? data.message : `Blokbay API error (HTTP ${res.status}).`;
      throw new BlokbayError(message, { status: res.status, code, retryAfter, headers: res.headers, body: data });
    }
  }
}
const backoff = (attempt) => Math.min(4000, 500 * 2 ** attempt) + Math.floor(Math.random() * 200);

const ALIASES = { success_url: 'url_success', cancel_url: 'url_cancel' };

class Payments {
  constructor(client) { Object.defineProperty(this, '_c', { value: client, enumerable: false }); }

  /**
   * Create a payment: POST /payments. Redirect your customer to the returned `url`.
   * `idempotencyKey` is sent as the Idempotency-Key header, not in the body.
   */
  create(params = {}, options = {}) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new TypeError('payments.create: pass an object.');
    const { idempotencyKey = options.idempotencyKey, ...rest } = params;
    const body = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined) continue;
      const name = ALIASES[k] || k;
      if (name in body && k !== name) continue; // the documented name wins over the alias
      body[name] = v;
    }
    if (body.amount === undefined || body.amount === null || body.amount === '') throw new TypeError('payments.create: amount is required.');
    return this._c.request('POST', '/payments', { body, idempotencyKey });
  }

  /** Retrieve one payment: GET /payments/:id (id starts with gp_). */
  retrieve(id) {
    if (typeof id !== 'string' || !id) throw new TypeError('payments.retrieve: pass the payment id (gp_...).');
    return this._c.request('GET', '/payments/' + encodeURIComponent(id));
  }

  /** List payments, newest first: GET /payments?reference=&limit= (limit 1 to 50, default 20). */
  list(params = {}) {
    const { reference, limit } = params || {};
    return this._c.request('GET', '/payments', { query: { reference, limit } });
  }
}

// ---------- Webhooks ----------

const toBytes = (x) => {
  if (typeof x === 'string') return enc.encode(x);
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  throw new TypeError('verifyWebhook: rawBody must be the raw request body (string, Uint8Array, Buffer or ArrayBuffer), before any JSON parsing.');
};

async function hmacHex(secret, bytes) {
  const subtle = await getSubtle();
  if (!subtle) throw new Error('Blokbay: Web Crypto (crypto.subtle) is not available. Use Node.js 18+, Deno, Bun or Workers.');
  const key = await subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await subtle.sign('HMAC', key, bytes));
  let out = ''; for (const b of sig) out += b.toString(16).padStart(2, '0');
  return out;
}

// Constant time comparison of two strings (time depends only on the length of a).
function safeEqual(a, b) {
  a = String(a); b = String(b);
  let diff = a.length === b.length ? 0 : 1; const x = diff ? a : b;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ x.charCodeAt(i);
  return diff === 0;
}

/** Parse the Blokbay-Signature header "t=<unix seconds>,v1=<hex>". */
export function parseSignatureHeader(header) {
  const out = {};
  for (const part of String(header || '').split(',')) {
    const i = part.indexOf('='); if (i < 1) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * Verify the Blokbay-Signature header of a webhook.
 * v1 = lowercase hex HMAC-SHA256 of "<t>.<raw body>" with your signing secret (whsec_...).
 * Rejects a t more than `tolerance` seconds (default 300) away from now.
 * @returns {Promise<boolean>}
 */
export async function verifyWebhook(rawBody, signatureHeader, secret, { tolerance = DEFAULT_TOLERANCE, now } = {}) {
  if (!secret || typeof secret !== 'string' || !signatureHeader) return false;
  const p = parseSignatureHeader(signatureHeader);
  if (!p.t || !p.v1 || !/^\d+$/.test(p.t) || !/^[0-9a-f]{64}$/i.test(p.v1)) return false;
  const nowSec = (now === undefined ? Date.now() : now instanceof Date ? now.getTime() : Number(now)) / 1000;
  if (!(Math.abs(nowSec - Number(p.t)) <= tolerance)) return false;
  const body = toBytes(rawBody);
  const prefix = enc.encode(p.t + '.');
  const msg = new Uint8Array(prefix.length + body.length); msg.set(prefix, 0); msg.set(body, prefix.length);
  return safeEqual(await hmacHex(secret, msg), p.v1.toLowerCase());
}

/**
 * Verify a webhook and return the parsed event. Throws BlokbayError (code "invalid_signature") if the signature is wrong.
 */
export async function constructEvent(rawBody, signatureHeader, secret, options = {}) {
  if (!(await verifyWebhook(rawBody, signatureHeader, secret, options))) {
    throw new BlokbayError('Invalid Blokbay webhook signature.', { status: 400, code: 'invalid_signature' });
  }
  const text = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(toBytes(rawBody));
  return JSON.parse(text);
}

/** Sign a payload like the Blokbay server does (useful for your own tests). Returns the full header value. */
export async function signWebhook(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const t = String(Math.floor(Number(timestamp)));
  const body = toBytes(rawBody); const prefix = enc.encode(t + '.');
  const msg = new Uint8Array(prefix.length + body.length); msg.set(prefix, 0); msg.set(body, prefix.length);
  return `t=${t},v1=${await hmacHex(secret, msg)}`;
}

Blokbay.verifyWebhook = verifyWebhook;
Blokbay.constructEvent = constructEvent;
Blokbay.BlokbayError = BlokbayError;
export default Blokbay;
