'use strict';

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * PayNext JavaScript SDK
 * Official client for Node.js and React/Next.js
 * Version: 1.0.0
 */
class PayNextClient {
  /**
   * @param {Object} config
   * @param {string} config.apiKey       - Your app's API key  (pk_...)
   * @param {string} config.apiSecret    - Your app's API secret (sk_...)
   * @param {string} [config.baseUrl]    - Override base URL (default: https://paynext.one)
   * @param {number} [config.timeout]    - Request timeout in ms (default: 30000)
   */
  constructor({ apiKey, apiSecret, baseUrl = 'https://paynext.one', timeout = 30000 } = {}) {
    if (!apiKey)    throw new PayNextError('apiKey is required', 'MISSING_API_KEY');
    if (!apiSecret) throw new PayNextError('apiSecret is required', 'MISSING_API_SECRET');

    this._apiKey    = apiKey;
    this._apiSecret = apiSecret;
    this._baseUrl   = baseUrl.replace(/\/$/, '');
    this._timeout   = timeout;

    // Expose namespaced resource clients
    this.customers     = new CustomersResource(this);
    this.plans         = new PlansResource(this);
    this.subscriptions = new SubscriptionsResource(this);
    this.checkout      = new CheckoutResource(this);
    this.webhooks      = new WebhooksResource(this);
  }

  // ─── Core Request Engine ─────────────────────────────────────────────────

  /**
   * Sign and send an authenticated request to the PayNext API.
   * @param {string} method  - HTTP method (GET, POST, PUT, DELETE)
   * @param {string} path    - API path e.g. /v1/customers
   * @param {Object} [body]  - Request body (for POST/PUT)
   * @returns {Promise<Object>} Parsed JSON response
   */
  async request(method, path, body = null) {
    const timestamp  = Math.floor(Date.now() / 1000).toString();
    const bodyString = body ? JSON.stringify(body) : '';
    const signature  = this._sign(method, path, timestamp, bodyString);

    const url        = new URL(this._baseUrl + path);
    const isHttps    = url.protocol === 'https:';
    const transport  = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method:   method.toUpperCase(),
      timeout:  this._timeout,
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'Authorization': `Bearer ${this._apiKey}`,
        'X-Signature':   signature,
        'X-Timestamp':   timestamp,
        ...(bodyString ? { 'Content-Length': Buffer.byteLength(bodyString) } : {}),
      },
    };

    return new Promise((resolve, reject) => {
      const req = transport.request(options, (res) => {
        let raw = '';
        res.on('data', chunk => (raw += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            return reject(new PayNextError('Invalid JSON response from server', 'PARSE_ERROR'));
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const err = new PayNextError(
              parsed.message || parsed.error || `HTTP ${res.statusCode}`,
              parsed.error   || 'API_ERROR',
              res.statusCode,
              parsed
            );
            reject(err);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new PayNextError('Request timed out', 'TIMEOUT'));
      });

      req.on('error', (e) => {
        reject(new PayNextError(e.message, 'NETWORK_ERROR'));
      });

      if (bodyString) req.write(bodyString);
      req.end();
    });
  }

  // ─── HMAC Signature ──────────────────────────────────────────────────────

  /**
   * Generate HMAC-SHA256 signature.
   * Payload format: METHOD\nFULL_PATH\nTIMESTAMP\nBODY
   */
  _sign(method, path, timestamp, body) {
    const payload = [method.toUpperCase(), path, timestamp, body].join('\n');
    return crypto
      .createHmac('sha256', this._apiSecret)
      .update(payload)
      .digest('hex');
  }

  // ─── Webhook Verification ────────────────────────────────────────────────

  /**
   * Verify an incoming webhook signature from PayNext.
   * Call this in your webhook receiver endpoint.
   *
   * @param {string|Buffer} rawBody    - Raw request body (do NOT parse before this)
   * @param {string}        signature  - Value of X-PayNext-Signature header
   * @param {string}        secret     - Your webhook endpoint's signing secret
   * @returns {boolean}
   */
  static verifyWebhook(rawBody, signature, secret) {
    if (!rawBody || !signature || !secret) return false;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    // Use timingSafeEqual to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(signature, 'hex')
      );
    } catch {
      return false;
    }
  }
}

// ─── Resource Classes ────────────────────────────────────────────────────────

class CustomersResource {
  constructor(client) { this._c = client; }

  /** List all customers (paginated)
   * @param {Object} params - { page, limit, search }
   */
  list(params = {}) {
    const qs = buildQS(params);
    return this._c.request('GET', `/v1/customers${qs}`);
  }

  /** Get a single customer by PayNext ID */
  get(id) {
    return this._c.request('GET', `/v1/customers/${id}`);
  }

  /** Get a customer by your own external_id */
  getByExternalId(externalId) {
    return this._c.request('GET', `/v1/customers/external/${externalId}`);
  }

  /** Create a new customer
   * @param {Object} data - { name, email, phone, country, currency, external_id }
   */
  create(data) {
    return this._c.request('POST', '/v1/customers', data);
  }

  /** Update an existing customer */
  update(id, data) {
    return this._c.request('PUT', `/v1/customers/${id}`, data);
  }

  /** Soft-delete a customer */
  delete(id) {
    return this._c.request('DELETE', `/v1/customers/${id}`);
  }
}

class PlansResource {
  constructor(client) { this._c = client; }

  /** List all active plans */
  list(params = {}) {
    const qs = buildQS(params);
    return this._c.request('GET', `/v1/plans${qs}`);
  }

  /** Get a plan by PayNext ID */
  get(id) {
    return this._c.request('GET', `/v1/plans/${id}`);
  }

  /** Get a plan by its plan_code slug */
  getByCode(code) {
    return this._c.request('GET', `/v1/plans/code/${code}`);
  }
}

class SubscriptionsResource {
  constructor(client) { this._c = client; }

  /** List subscriptions
   * @param {Object} params - { app_id, status, page, limit }
   */
  list(params = {}) {
    const qs = buildQS(params);
    return this._c.request('GET', `/v1/subscriptions${qs}`);
  }

  /** Get a single subscription */
  get(id) {
    return this._c.request('GET', `/v1/subscriptions/${id}`);
  }

  /** Cancel a subscription */
  cancel(id, data = {}) {
    return this._c.request('POST', `/v1/subscriptions/${id}/cancel`, data);
  }

  /** Pause a subscription */
  pause(id) {
    return this._c.request('POST', `/v1/subscriptions/${id}/pause`);
  }

  /** Resume a paused subscription */
  resume(id) {
    return this._c.request('POST', `/v1/subscriptions/${id}/resume`);
  }
}

class CheckoutResource {
  constructor(client) { this._c = client; }

  /** Create a new checkout session
   * @param {Object} data
   * @param {string} data.customer_id   - PayNext customer ID
   * @param {string} data.plan_id       - PayNext plan ID
   * @param {string} data.billing_cycle - 'monthly' | 'yearly'
   * @param {string} [data.success_url] - Where to redirect after payment
   * @param {string} [data.cancel_url]  - Where to redirect on cancel
   * @param {string} [data.discount_code]
   * @returns {{ checkout_url: string, session_id: string }}
   */
  createSession(data) {
    return this._c.request('POST', '/v1/checkout/sessions', data);
  }

  /** Get a checkout session by ID */
  getSession(id) {
    return this._c.request('GET', `/v1/checkout/sessions/${id}`);
  }
}

class WebhooksResource {
  constructor(client) { this._c = client; }

  /** Verify an inbound webhook — static helper exposed on instance too */
  verify(rawBody, signature, secret) {
    return PayNextClient.verifyWebhook(rawBody, signature, secret);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildQS(params) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

// ─── Error Class ─────────────────────────────────────────────────────────────

class PayNextError extends Error {
  constructor(message, code = 'UNKNOWN', statusCode = null, raw = null) {
    super(message);
    this.name       = 'PayNextError';
    this.code       = code;
    this.statusCode = statusCode;
    this.raw        = raw;
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { PayNextClient, PayNextError };
