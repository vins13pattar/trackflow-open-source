import { api } from './api';

interface RazorpayInstance {
  open: () => void;
}
interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  handler: () => void;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
}
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

const SDK_URL = 'https://checkout.razorpay.com/v1/checkout.js';

function loadSdk(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

/**
 * Starts a plan checkout. When a payment gateway is configured the Razorpay
 * modal opens and the plan change is finalized server-side by the webhook; with
 * no keys (local/dev) it falls back to the confirm endpoint so the flow still
 * works end to end. Resolves once payment is submitted (or the dev upgrade
 * completes); rejects if the user dismisses the modal.
 */
export async function startCheckout(plan: string, billingCycle: 'monthly' | 'annual' = 'monthly'): Promise<void> {
  const { orderId, amountInr, currency, keyId, mock } = await api.checkout(plan, billingCycle);

  // No gateway configured: complete via the dev confirm endpoint.
  if (mock || !keyId) {
    await api.upgradePlan(plan, billingCycle);
    return;
  }

  if (!(await loadSdk())) throw new Error('Could not load the payment gateway. Please try again.');
  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new Error('Payment gateway unavailable.');

  await new Promise<void>((resolve, reject) => {
    const rzp = new Razorpay({
      key: keyId,
      order_id: orderId,
      amount: amountInr * 100,
      currency,
      name: 'TrackFlow',
      description: `${plan} plan (${billingCycle})`,
      handler: () => resolve(), // payment captured; the webhook applies the upgrade
      modal: { ondismiss: () => reject(new Error('Payment cancelled.')) },
    });
    rzp.open();
  });
}
