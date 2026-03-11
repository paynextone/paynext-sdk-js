/**
 * PayNext SDK – Node.js / Express Examples
 * ==========================================
 * These examples show how Evalios, Matix Workspace, or any Node.js app
 * can integrate with PayNext.
 */

const { PayNextClient, PayNextError } = require('paynext-sdk');

// ─── 1. Initialize the Client ─────────────────────────────────────────────────
//
// Store these in environment variables — never hardcode them.
//
const paynext = new PayNextClient({
  apiKey:    process.env.PAYNEXT_API_KEY,    // pk_live_...
  apiSecret: process.env.PAYNEXT_API_SECRET, // sk_live_...
  baseUrl:   'https://paynext.one',           // or your custom domain
});


// ─── 2. Create a Customer ────────────────────────────────────────────────────

async function createCustomer() {
  try {
    const response = await paynext.customers.create({
      name:        'Ahmed Al-Rashid',
      email:       'ahmed@evalios.com',
      phone:       '+966501234567',
      country:     'SA',             // ISO 2-letter country code
      currency:    'SAR',            // ISO 3-letter currency code
      external_id: 'evalios-user-101', // Your own user ID for easy lookup later
    });

    console.log('Customer created:', response.data);
    // response.data = { id: 'CUS-XXXXXX', name: 'Ahmed Al-Rashid', ... }
    return response.data;

  } catch (err) {
    if (err instanceof PayNextError) {
      console.error(`PayNext error [${err.code}]:`, err.message);
    }
    throw err;
  }
}


// ─── 3. List Available Plans ─────────────────────────────────────────────────

async function listPlans() {
  const response = await paynext.plans.list();
  console.log('Available plans:', response.data);
  return response.data;
  // Returns array: [{ id, plan_code, name_en, name_ar, price_monthly, price_yearly, trial_days }]
}


// ─── 4. Start a Checkout Session (Core Flow) ─────────────────────────────────
//
// Use this when a user clicks "Subscribe" or "Upgrade" in your app.
// Redirect them to the returned checkout_url.

async function startCheckout(customerId, planId) {
  const response = await paynext.checkout.createSession({
    customer_id:   customerId,
    plan_id:       planId,
    billing_cycle: 'monthly',             // 'monthly' | 'yearly'
    success_url:   'https://evalios.com/subscription/success',
    cancel_url:    'https://evalios.com/pricing',
    // discount_code: 'LAUNCH50',         // Optional
  });

  const { checkout_url, session_id } = response.data;
  console.log('Redirect user to:', checkout_url);

  // In Express: res.redirect(checkout_url);
  // In Next.js: router.push(checkout_url) or window.location.href = checkout_url
  return checkout_url;
}


// ─── 5. Check a Customer's Subscription Status ───────────────────────────────

async function getCustomerSubscription(externalId) {
  // Look up customer by YOUR own user ID
  const customerRes = await paynext.customers.getByExternalId(externalId);
  const customer    = customerRes.data;

  // Get their subscriptions
  const subsRes = await paynext.subscriptions.list({ customer_id: customer.id });
  const active  = subsRes.data.find(s => s.status === 'active');

  if (active) {
    console.log(`Active plan: ${active.plan.name_en}, renews: ${active.current_period_end}`);
  } else {
    console.log('No active subscription');
  }

  return active || null;
}


// ─── 6. Cancel a Subscription ────────────────────────────────────────────────

async function cancelSubscription(subscriptionId) {
  const response = await paynext.subscriptions.cancel(subscriptionId, {
    cancel_at_period_end: true, // Cancel gracefully at end of billing period
  });
  console.log('Subscription cancelled:', response.data);
}


// ─── 7. Webhook Receiver (Express) ───────────────────────────────────────────
//
// Register this route in your Express app to receive PayNext events.
// IMPORTANT: Use express.raw() on this route — NOT express.json()

const express = require('express');
const app     = express();

app.post(
  '/webhooks/paynext',
  express.raw({ type: 'application/json' }), // Raw body needed for signature check
  (req, res) => {
    const signature     = req.headers['x-paynext-signature'];
    const webhookSecret = process.env.PAYNEXT_WEBHOOK_SECRET;

    // Step 1 – Verify the signature
    const isValid = PayNextClient.verifyWebhook(req.body, signature, webhookSecret);
    if (!isValid) {
      console.warn('Invalid webhook signature – possible spoofing attempt');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Step 2 – Parse the event
    const event = JSON.parse(req.body.toString());
    console.log(`Received event: ${event.type}`);

    // Step 3 – Handle specific events
    switch (event.type) {

      case 'subscription.activated': {
        const { subscription, customer } = event.data;
        // ✅ Unlock features for this user in your app
        console.log(`Activate features for customer: ${customer.external_id}`);
        // e.g. await db.users.update({ hasPro: true }, { where: { id: customer.external_id } })
        break;
      }

      case 'subscription.cancelled': {
        const { subscription, customer } = event.data;
        // ❌ Revoke features when subscription ends
        console.log(`Revoke features for customer: ${customer.external_id}`);
        break;
      }

      case 'payment.succeeded': {
        const { payment, invoice } = event.data;
        console.log(`Payment received: ${payment.amount} ${payment.currency}`);
        // e.g. send a receipt email
        break;
      }

      case 'payment.failed': {
        const { customer } = event.data;
        console.log(`Payment failed for: ${customer.email}`);
        // e.g. send a payment failure notification
        break;
      }

      case 'subscription.paused':
      case 'subscription.resumed':
      case 'subscription.expired':
        console.log(`Subscription status changed: ${event.type}`, event.data);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    // Step 4 – Always respond with 200 quickly
    res.status(200).json({ received: true });
  }
);

module.exports = { createCustomer, listPlans, startCheckout, getCustomerSubscription, cancelSubscription };
