# PayNext JavaScript SDK

Official Node.js and Next.js client for [PayNext](https://paynext.one) — SaaS Billing & Subscription Platform.

## Installation
```bash
npm install paynext-sdk
```

## Quick Start
```javascript
const { PayNextClient } = require('paynext-sdk');

const paynext = new PayNextClient({
  apiKey:    process.env.PAYNEXT_API_KEY,
  apiSecret: process.env.PAYNEXT_API_SECRET,
  baseUrl:   'https://paynext.one',
});

// Create a checkout session
const session = await paynext.checkout.createSession({
  customer_id:   'CUS-XXXXXX',
  plan_id:       'PLAN-XXXXXX',
  billing_cycle: 'monthly',
  success_url:   'https://yourapp.com/success',
  cancel_url:    'https://yourapp.com/pricing',
});

// Redirect user to hosted checkout
res.redirect(session.data.checkout_url);
```

## Features

- ✅ Automatic HMAC-SHA256 request signing
- ✅ Customers — create, get, update, delete
- ✅ Plans — list, get by ID or code
- ✅ Subscriptions — list, cancel, pause, resume
- ✅ Checkout sessions — create and retrieve
- ✅ Webhook signature verification
- ✅ Zero dependencies — uses Node.js built-ins only

## Documentation

Full integration guide: [paynext.one/docs](https://paynext.one/docs)

## Examples

| File | Description |
|------|-------------|
| `examples/nodejs-express.js` | Express.js integration with webhook receiver |
| `examples/nextjs-app-router.js` | Next.js 13+ App Router with API routes |
| `examples/.env.example` | Environment variable template |

## Environment Variables
```bash
PAYNEXT_API_KEY=pk_live_xxxxxxxxxxxxxxxxxxxx
PAYNEXT_API_SECRET=sk_live_xxxxxxxxxxxxxxxxxxxx
PAYNEXT_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxx
```

Get your credentials from: **PayNext Admin → Apps → Your App → API Keys**

## License

MIT
