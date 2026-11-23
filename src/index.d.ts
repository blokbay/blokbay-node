// Type definitions for blokbay 1.0.0 (https://blokbay.com/docs/api)

export declare const VERSION: string;
export declare const DEFAULT_BASE_URL: string;
export declare const DEFAULT_TOLERANCE: number;

/** Currencies accepted by POST /payments. JPY has no decimals. */
export type Currency = 'USD' | 'EUR' | 'GBP' | 'CHF' | 'JPY' | 'CAD' | 'AUD' | 'SGD' | 'HKD' | 'AED';
export type PaymentStatus = 'pending' | 'paid' | 'expired';
export type Network = 'Ethereum' | 'Polygon' | 'BNB Chain' | 'Base' | 'Arbitrum' | 'Bitcoin';
export type Coin = 'USDC' | 'USDT' | 'ETH' | 'BTC';
export type RateKind = 'live' | 'stored' | 'bundled';

export interface ClientOptions {
  /** Default https://blokbay.com/api/v1 */
  baseUrl?: string;
  /** Custom fetch (tests, proxies). Default globalThis.fetch. */
  fetch?: typeof fetch;
  /** Request timeout in milliseconds. Default 30000. 0 disables it. */
  timeout?: number;
  /** Retries for GET requests and for POST with an idempotencyKey (network errors, 429, 5xx). Default 2. */
  maxRetries?: number;
  userAgent?: string;
}

export interface PaymentCreateParams {
  /** Amount in `currency`, string or number, at most 2 decimals (JPY: none). From the equivalent of 1.00 USD. */
  amount: string | number;
  /** Default USD. */
  currency?: Currency | Lowercase<Currency>;
  /** Your order number, up to 100 characters. */
  reference?: string;
  /** Shown to the customer, up to 200 characters. */
  description?: string;
  /** Optional: a receipt is sent to the customer. */
  customer_email?: string;
  /** http(s) URL where the customer returns after paying (?blokbay_payment=<id> is added). */
  url_success?: string;
  /** http(s) URL of the link "Cancel and return to the site". */
  url_cancel?: string;
  /** Alias of url_success (SDK convenience). */
  success_url?: string;
  /** Alias of url_cancel (SDK convenience). */
  cancel_url?: string;
  /** Sent as the Idempotency-Key header (up to 100 characters), not in the body. */
  idempotencyKey?: string;
  [extra: string]: unknown;
}

export interface ResponseInfo {
  status: number;
  headers: Headers;
  /** true when the Idempotency-Key matched an existing payment (status 200 instead of 201). */
  idempotentReplayed: boolean;
}

export interface Payment {
  id: string;
  object: 'payment';
  status: PaymentStatus;
  /** As created, in `currency`. */
  amount: string;
  currency: Currency;
  /** USD equivalent used for the payment. */
  amount_usd: string;
  /** Units of `currency` per 1 USD ("1" for USD). */
  exchange_rate: string;
  rate_at: string | null;
  rate_source: string | null;
  rate_kind: RateKind | null;
  /** false while the USD equivalent is an estimate; true once the buyer chooses the coin (always true for USD). */
  rate_locked: boolean;
  reference: string;
  description: string;
  customer_email: string | null;
  /** Payment page: redirect your customer here. */
  url: string;
  test: boolean;
  link: string | null;
  network: Network | null;
  coin: Coin | null;
  tx: string | null;
  /** With Bitcoin, the two transfers. */
  transactions: string[];
  created_at: string | null;
  expires_at: string | null;
  paid_at: string | null;
  /** Not enumerable: HTTP details of the response. */
  readonly lastResponse?: ResponseInfo;
}

export interface PaymentList {
  object: 'list';
  data: Payment[];
  readonly lastResponse?: ResponseInfo;
}

export interface PaymentListParams {
  reference?: string;
  /** 1 to 50, default 20. */
  limit?: number;
}

export interface WebhookEvent<T = Payment> {
  id: string;
  type: 'payment.paid' | 'payment.expired' | 'ping' | (string & {});
  /** Unix seconds. */
  created: number;
  /** Your public key (pk_live_...). */
  account: string | null;
  data: T;
}

export interface PingData { message: string; url: string }

export interface VerifyOptions {
  /** Maximum distance between the header timestamp and now, in seconds. Default 300. */
  tolerance?: number;
  /** Current time (milliseconds or Date), for tests. */
  now?: number | Date;
}

export type RawBody = string | Uint8Array | ArrayBuffer | ArrayBufferView;

export declare class BlokbayError extends Error {
  /** HTTP status, 0 for network errors and timeouts. */
  status: number;
  /** API error code ("amount", "unauthorized", "rate_limited", ...), or "connection_error", "timeout", "invalid_response", "invalid_signature". */
  code: string;
  /** Seconds from the Retry-After header, if any. */
  retryAfter: number | null;
  headers: Headers | null;
  body: unknown;
}

declare class Payments {
  create(params: PaymentCreateParams, options?: { idempotencyKey?: string }): Promise<Payment>;
  retrieve(id: string): Promise<Payment>;
  list(params?: PaymentListParams): Promise<PaymentList>;
}

export declare class Blokbay {
  constructor(secretKey: string, options?: ClientOptions);
  readonly baseUrl: string;
  timeout: number;
  maxRetries: number;
  readonly payments: Payments;
  request<T = unknown>(method: 'GET' | 'POST', path: string, options?: { body?: unknown; query?: Record<string, string | number | undefined | null>; idempotencyKey?: string }): Promise<T>;
  static verifyWebhook: typeof verifyWebhook;
  static constructEvent: typeof constructEvent;
  static BlokbayError: typeof BlokbayError;
}

export declare function parseSignatureHeader(header: string | null | undefined): Record<string, string>;
export declare function verifyWebhook(rawBody: RawBody, signatureHeader: string | null | undefined, secret: string, options?: VerifyOptions): Promise<boolean>;
export declare function constructEvent<T = Payment>(rawBody: RawBody, signatureHeader: string | null | undefined, secret: string, options?: VerifyOptions): Promise<WebhookEvent<T>>;
export declare function signWebhook(rawBody: RawBody, secret: string, timestamp?: number): Promise<string>;

export default Blokbay;
