import crypto from "crypto";

// Razorpay integration via REST (no SDK dependency). Credentials come from env:
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET   — creating payment links (Basic auth)
//   RAZORPAY_WEBHOOK_SECRET                — verifying inbound webhook signatures
// Nothing works until these are set; helpers fail gracefully when they are not.

const BASE = "https://api.razorpay.com/v1";

export function razorpayConfigured() {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export async function createRazorpayPaymentLink(params: {
  amountPaise: number;
  description: string;
  customer: { name: string; email?: string; contact?: string };
  notes: Record<string, string>;
}): Promise<{ id: string; short_url: string; status: string }> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("Razorpay is not configured (missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)");
  }
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const res = await fetch(`${BASE}/payment_links`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({
      amount: params.amountPaise,
      currency: "INR",
      accept_partial: false,
      description: params.description.slice(0, 2048),
      customer: {
        name: params.customer.name,
        ...(params.customer.email ? { email: params.customer.email } : {}),
        ...(params.customer.contact ? { contact: params.customer.contact } : {}),
      },
      notify: { sms: !!params.customer.contact, email: !!params.customer.email },
      reminder_enable: true,
      notes: params.notes,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.description || `Razorpay API error (${res.status})`);
  }
  return data;
}

// Razorpay signs the webhook body with HMAC-SHA256 using the webhook secret and
// sends it in the X-Razorpay-Signature header. Verify against the RAW body.
export function verifyRazorpaySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
