/**
 * PayNext SDK – Next.js Integration Examples
 * ============================================
 * Examples for Next.js 13+ App Router.
 * All PayNext calls must stay in Server Components, API Routes,
 * or Server Actions — never expose your API secret to the browser.
 */

// ─────────────────────────────────────────────────────────────────────────────
// FILE: lib/paynext.js   (shared server-side client — import only in server code)
// ─────────────────────────────────────────────────────────────────────────────
import { PayNextClient } from 'paynext-sdk';

export const paynext = new PayNextClient({
  apiKey:    process.env.PAYNEXT_API_KEY,
  apiSecret: process.env.PAYNEXT_API_SECRET,
  baseUrl:   process.env.PAYNEXT_BASE_URL || 'https://paynext.one',
});


// ─────────────────────────────────────────────────────────────────────────────
// FILE: app/api/checkout/route.js   (API Route – creates checkout session)
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from 'next/server';
import { paynext }      from '@/lib/paynext';
import { getServerSession } from 'next-auth'; // or your own auth

export async function POST(request) {
  // Get logged-in user from your auth system
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { planId, billingCycle } = await request.json();

  try {
    // 1. Ensure the customer exists in PayNext (create if first time)
    let customer;
    try {
      const res = await paynext.customers.getByExternalId(session.user.id);
      customer = res.data;
    } catch {
      // First time — create the customer
      const res = await paynext.customers.create({
        name:        session.user.name,
        email:       session.user.email,
        country:     session.user.country || 'SA',
        currency:    session.user.currency || 'SAR',
        external_id: session.user.id,
      });
      customer = res.data;
    }

    // 2. Create the checkout session
    const checkoutRes = await paynext.checkout.createSession({
      customer_id:   customer.id,
      plan_id:       planId,
      billing_cycle: billingCycle,
      success_url:   `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?subscribed=true`,
      cancel_url:    `${process.env.NEXT_PUBLIC_APP_URL}/pricing`,
    });

    return NextResponse.json({
      checkoutUrl: checkoutRes.data.checkout_url,
      sessionId:   checkoutRes.data.session_id,
    });

  } catch (err) {
    console.error('PayNext checkout error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// FILE: app/api/webhooks/paynext/route.js   (Webhook receiver)
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from 'next/server';
import { PayNextClient } from 'paynext-sdk';

// IMPORTANT: Disable Next.js body parsing so we get the raw body
export const config = { api: { bodyParser: false } };

export async function POST(request) {
  const rawBody   = await request.text();
  const signature = request.headers.get('x-paynext-signature');
  const secret    = process.env.PAYNEXT_WEBHOOK_SECRET;

  // Verify signature
  const isValid = PayNextClient.verifyWebhook(rawBody, signature, secret);
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(rawBody);

  switch (event.type) {
    case 'subscription.activated': {
      const { customer } = event.data;
      // Update your DB: mark user as subscribed
      // await prisma.user.update({ where: { id: customer.external_id }, data: { isPro: true } });
      console.log('Activated:', customer.external_id);
      break;
    }
    case 'subscription.cancelled':
    case 'subscription.expired': {
      const { customer } = event.data;
      // await prisma.user.update({ where: { id: customer.external_id }, data: { isPro: false } });
      console.log('Deactivated:', customer.external_id);
      break;
    }
    case 'payment.succeeded':
      console.log('Payment received:', event.data.payment?.amount);
      break;
  }

  return NextResponse.json({ received: true });
}


// ─────────────────────────────────────────────────────────────────────────────
// FILE: components/SubscribeButton.jsx   (Client Component)
// ─────────────────────────────────────────────────────────────────────────────
'use client';
import { useState } from 'react';

export default function SubscribeButton({ planId, billingCycle = 'monthly', label = 'Subscribe' }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  async function handleSubscribe() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ planId, billingCycle }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Checkout failed');

      // Redirect to PayNext hosted checkout page
      window.location.href = data.checkoutUrl;

    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleSubscribe}
        disabled={loading}
        style={{
          padding: '12px 24px',
          background: loading ? '#ccc' : '#2563eb',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: '16px',
          fontWeight: '600',
        }}
      >
        {loading ? 'Redirecting...' : label}
      </button>
      {error && <p style={{ color: 'red', marginTop: '8px' }}>{error}</p>}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// FILE: app/dashboard/page.jsx   (Server Component — check subscription status)
// ─────────────────────────────────────────────────────────────────────────────
import { paynext }          from '@/lib/paynext';
import { getServerSession } from 'next-auth';

export default async function DashboardPage() {
  const session = await getServerSession();
  let subscription = null;

  if (session) {
    try {
      const customer  = await paynext.customers.getByExternalId(session.user.id);
      const subsRes   = await paynext.subscriptions.list({ customer_id: customer.data.id });
      subscription    = subsRes.data.find(s => s.status === 'active') || null;
    } catch {
      // Customer may not exist yet — new user
    }
  }

  return (
    <div>
      <h1>Dashboard</h1>
      {subscription ? (
        <p>
          ✅ You are on the <strong>{subscription.plan.name_en}</strong> plan.
          Renews: {new Date(subscription.current_period_end).toLocaleDateString()}
        </p>
      ) : (
        <p>❌ No active subscription. <a href="/pricing">View Plans</a></p>
      )}
    </div>
  );
}
