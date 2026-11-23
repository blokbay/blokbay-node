// Signature vectors computed with the Blokbay server code (src/gateway.js webhookSecret + signPayload, 23/11/2026):
// secret = webhookSecret({ GATEWAY_KEY: 'test-gateway-key-0123456789abcdef0123456789' }, 'sh_test', 1), timestamp 1795320600.
export const SERVER_VECTOR = {
  secret: 'whsec_a94d4b6e082d6ce620991a0e475d1444e8d1f22548522a11',
  t: 1795320600,
  body: '{"id":"evt_7h2k9x","type":"payment.paid","created":1795320600,"account":"pk_live_0a1b2c3d4e5f60718293a4b5","data":{"id":"gp_k2x9m4q7r1","object":"payment","status":"paid","amount":"249.90","currency":"USD","amount_usd":"249.90","exchange_rate":"1","rate_at":null,"rate_source":null,"rate_kind":null,"rate_locked":true,"reference":"1001","description":"Order 1001","customer_email":null,"url":"https://blokbay.com/pay/gp_k2x9m4q7r1","test":false,"link":null,"network":"Polygon","coin":"USDC","tx":"0x1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f","transactions":["0x1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f"],"created_at":"2026-11-22T04:00:00.000Z","expires_at":"2026-11-23T04:00:00.000Z","paid_at":"2026-11-22T04:10:00.000Z"}}',
  v1: '4d86997cb7afbda5e75dd879e351c0ebe55c69c538fed2d139015496fb606c1c',
};
