# Blokbay: crypto payment gateway for Node.js (Bitcoin, USDT, USDC, ETH)

Official JavaScript client for the [Blokbay payments API](https://blokbay.com/docs/api). Accept crypto payments on your own website in a few lines: create a payment, redirect your customer to the hosted payment page, receive a signed webhook when the payment is confirmed on the network.

- **Coins**: BTC, USDC, USDT and ETH. USDC on Ethereum, Polygon, BNB Chain, Base and Arbitrum; USDT on Ethereum, Polygon, BNB Chain and Arbitrum; ETH on Ethereum.
- **Non-custodial**: funds go from the buyer's wallet directly to yours in the same transaction, through a public split contract. Blokbay never holds them.
- **Prices in your currency**: USD, EUR, GBP, CHF, JPY, CAD, AUD, SGD, HKD, AED.
- **1% per payment**, no fixed costs.
- **Zero dependencies**, ESM with TypeScript types. Runs on Node.js 18+, Deno, Bun and Cloudflare Workers (only `fetch` and Web Crypto).

Gateway overview: https://blokbay.com/crypto-payment-gateway . Full API reference: https://blokbay.com/docs/api .

## Install

```sh
npm install blokbay
```

Deno: `import Blokbay from 'npm:blokbay';`. Bun: `bun add blokbay`.

The package is an ES module: use `import`. With CommonJS `require('blokbay')` works on Node 22 and later; on Node 18 and 20 use `const { default: Blokbay } = await import('blokbay')`.

## Get your keys

Sign in at https://blokbay.com/login, add your wallet (EVM address and/or Bitcoin address) in **Settings**, then open **Payments on your site**: create your **secret key** (`sk_live_...`, shown once) and set your **webhook URL** to get the **signing secret** (`whsec_...`).

Use the secret key on your server only. The API refuses requests sent by a browser.

## Create a payment

```js
import Blokbay from 'blokbay';

const blokbay = new Blokbay(process.env.BLOKBAY_SECRET_KEY);

const payment = await blokbay.payments.create({
  amount: '249.90',              // string or number, at most 2 decimals (JPY: none)
  currency: 'USD',               // optional, default USD
  reference: '1001',             // your order number, up to 100 characters
  description: 'Order 1001',     // shown to the customer, up to 200 characters
  customer_email: 'buyer@example.com', // optional: receipt to the customer
  url_success: 'https://shop.example.com/thank-you',
  url_cancel: 'https://shop.example.com/cart',
  idempotencyKey: 'order-1001',  // sent as the Idempotency-Key header
});

// Redirect your customer to the hosted payment page
res.redirect(payment.url);
```

The payment page shows your store name and logo. After paying, the customer returns to `url_success` with `?blokbay_payment=<id>` added. `success_url` and `cancel_url` are accepted as aliases of `url_success` and `url_cancel`.

With the same `idempotencyKey` a retry returns the same payment instead of creating a new one (`payment.lastResponse.idempotentReplayed === true`). The key is scoped to the currency.

### Example in EUR

```js
const payment = await blokbay.payments.create({
  amount: '1250.00',
  currency: 'EUR',
  reference: 'A-2045',
  url_success: 'https://shop.example.com/thank-you',
  idempotencyKey: 'A-2045',
});
console.log(payment.amount, payment.currency); // "1250.00" "EUR", as created
console.log(payment.amount_usd, payment.rate_locked); // USD equivalent, an estimate until the buyer chooses the coin
```

Minimum: the equivalent of 1.00 USD. Bitcoin is offered to the customer from the equivalent of 100.00 USD.

## Retrieve and list payments

```js
const p = await blokbay.payments.retrieve('gp_k2x9...');
if (p.status === 'paid') {
  console.log(p.network, p.coin, p.tx, p.paid_at); // e.g. "Polygon" "USDC" "0x..."
}

const { data } = await blokbay.payments.list({ reference: '1001' }); // newest first, limit 1 to 50 (default 20)
```

`status` is `pending`, `paid` or `expired`. A payment that arrives after `expired` is still recorded as `paid` (the funds are already in your wallet): treat `paid` as final. With Bitcoin the buyer makes two exact transfers, both listed in `transactions`.

## Webhooks

Blokbay sends `POST` requests to your webhook URL for `payment.paid`, `payment.expired` and `ping`, with the header `Blokbay-Signature: t=<unix seconds>,v1=<hex>`. `v1` is the HMAC-SHA256 of `"<t>.<raw body>"` with your signing secret. `verifyWebhook` checks it in constant time and rejects timestamps more than 5 minutes away.

Always pass the **raw** request body, before any JSON parsing.

### Express

```js
import express from 'express';
import { constructEvent } from 'blokbay';

const app = express();
app.post('/webhooks/blokbay', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = await constructEvent(req.body, req.get('blokbay-signature'), process.env.BLOKBAY_WEBHOOK_SECRET);
  } catch {
    return res.status(400).send('bad signature');
  }
  if (event.type === 'payment.paid') {
    // event.data is the payment: check event.data.reference, amount and currency against your order,
    // then mark the order paid once (the same event can arrive more than once: use event.id)
  }
  res.sendStatus(200); // answer with a 2xx within 10 seconds
});
```

### Cloudflare Workers, Deno, Bun, Next.js route handlers

```js
import { verifyWebhook } from 'blokbay';

export default {
  async fetch(request, env) {
    const raw = await request.text();
    const ok = await verifyWebhook(raw, request.headers.get('blokbay-signature'), env.BLOKBAY_WEBHOOK_SECRET);
    if (!ok) return new Response('bad signature', { status: 400 });
    const event = JSON.parse(raw);
    // ...
    return new Response('ok');
  },
};
```

Options: `verifyWebhook(rawBody, signatureHeader, secret, { tolerance: 300 })`. `rawBody` can be a string, `Buffer`, `Uint8Array` or `ArrayBuffer`. Also check that `event.account` equals your public key (`pk_live_...`).

If your endpoint does not answer with a 2xx, Blokbay retries after 1 minute, 5 minutes, 30 minutes, 2, 6, 12, 24 and 24 hours.

## Errors

API errors throw a `BlokbayError`:

```js
import { BlokbayError } from 'blokbay';

try {
  await blokbay.payments.create({ amount: '0.50' });
} catch (e) {
  if (e instanceof BlokbayError) {
    console.log(e.status, e.code, e.message); // 400 "amount" "amount must be a USD amount ..."
  }
}
```

| Status | `code` |
| --- | --- |
| 400 | `amount`, `currency`, `reference`, `description`, `url_success`, `url_cancel`, `customer_email`, `bad_json` |
| 401 | `unauthorized` |
| 403 | `browser_not_allowed`, `account_disabled` |
| 404 | `not_found` |
| 409 | `no_wallet` (add a wallet in your Blokbay settings) |
| 429 | `rate_limited` (`e.retryAfter` in seconds) |
| 503 | `unavailable` |
| 0 | `connection_error`, `timeout` |
| 2xx | `invalid_response` (the answer is not JSON: check `baseUrl`) |

GET requests, and POST requests with an `idempotencyKey`, are retried automatically on network errors, 429 and 5xx (at most `maxRetries`, default 2; a `Retry-After` longer than 10 seconds is not waited for). A POST without `idempotencyKey` is never retried, so it can never create a second payment.

## Options

```js
new Blokbay(secretKey, {
  baseUrl: 'https://blokbay.com/api/v1', // default
  timeout: 30000,                        // milliseconds
  maxRetries: 2,
  fetch: customFetch,                    // optional
});
```

## Test it

There is no test mode with fake money: in the dashboard, **Create a 1 $ test payment** creates a real payment to your own wallet (`test: true`). Pay it on Polygon or Base, where the network cost is a few cents, to see the whole flow, webhook included.

## Links

- Crypto payment gateway: https://blokbay.com/crypto-payment-gateway
- API documentation: https://blokbay.com/docs/api
- Plugins for WooCommerce, PrestaShop, Magento 2, Shopware, OpenCart, Odoo and EC-CUBE: https://blokbay.com/crypto-payment-gateway#plugins
- Contact: mail@blokbay.com

You remain the seller: you are responsible for your website, your products and your obligations towards your customers. Crypto payments cannot be reversed by Blokbay.

## License

MIT
