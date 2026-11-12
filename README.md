# SecondMint

First we show you where you're losing money. Then we prove whether PayPal gets it back.
Product spec: [Product.md](Product.md).

## Setup (Braintree sandbox)

1. **API keys.** Copy `.env.example` to `.env` and fill in `BRAINTREE_MERCHANT_ID`, `BRAINTREE_PUBLIC_KEY`, and `BRAINTREE_PRIVATE_KEY` (sandbox Control Panel → Settings → API).
2. **Custom fields.** In the sandbox Control Panel → Settings → Processing → Custom Fields, add these seven fields, each set to **Store and pass back**:
   `sm_invoice_id`, `sm_subscription_id`, `sm_billing_date`, `sm_attempt_at`, `sm_attempt_no`, `sm_invoice_amount`, `sm_route`.
   They carry the simulated billing history on each sandbox transaction.
3. **Install and seed.**
   ```bash
   npm install
   npm run seed
   ```
   The seed creates the demo SaaS merchant in your sandbox: 3 plans, 1,000 customers with vaulted test cards and subscriptions, and about 90 days of failed renewals with retries, recoveries, and a few refunds (roughly 10 minutes). If it stops, run it again; it resumes where it left off.
4. **Run.**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 and click **Connect sandbox merchant**.

## For judges: what's real, what's assumed, and how it runs in production

**The setup is complete and correct.** SecondMint is the measurement layer: it diagnoses failed renewals, splits customers into two routes at random, runs every retry as a real Braintree sandbox charge (with no double charges), and reports the result with fixed statistical rules. None of that is simulated.

**What's real (Braintree sandbox):**
- Every customer, vaulted card, subscription and payment attempt is created in, and read back from, the Braintree sandbox.
- The Leak Diagnostic's numbers come from those transactions.

**What's assumed (and why):** a sandbox can't tell us how a real bank would answer a retry, and PayPal's Smart Retries can't be switched on per customer in a sandbox. So whether each retry succeeds comes from assumptions the merchant can see and edit on the Trial page. Each has an ⓘ citing its real-world source:

| Assumption | Default | Real-world source |
|---|---|---|
| Renewals that fail on first charge | 35% (demo; real-world ≈ 10%) | Braintree: acceptable decline ratio ≈ 10% |
| Failures that are soft (retryable) | 85% | Paddle: soft declines are 80–90% of failures |
| Soft declines the current process recovers | 30% | Redux Payments: 25–35% for B2C fixed schedules |
| Smart Retries uplift (Route B) | +7 pp | [Stripe × InVideo](https://stripe.com/customers/invideo): Smart Retries raised recovery from 23% to 30% |

So the trial's result in this demo reflects these market-based assumptions. It is not a measurement of PayPal's performance, and we never tune the values to force a win. If the data can't support a verdict, the report says "Inconclusive" and shows how much volume would be needed.

**In production:** Route B becomes a Braintree merchant account with PayPal's Smart Retries turned **on**, and Route A keeps the merchant's existing process (Smart Retries **off**). Real banks decide every retry, and the same assignment, ledger, statistics and report measure the real uplift. Turning Smart Retries on and off per merchant account needs PayPal Enterprise to set up.

## Wallet experiment (does adding PayPal recover more customers who must act?)
- **Design:** control sees today's card-only payment-update page; treatment sees the same page plus a PayPal button. It adds a choice and doesn't replace cards.
- **Primary metric:** recovered invoices ÷ every customer assigned, not just people who clicked PayPal.
- **Guardrails:** net revenue per assigned customer after fees (card 2.9% + $0.30, PayPal 3.49% + $0.49), and refunds.
- **Secondary:** the payment method is saved, and each customer is followed to their next renewal.
- **Real:**
  - The PayPal button on `/wallet` runs a live PayPal sandbox checkout that saves the wallet (vault).
  - "Charge next renewal" then charges that saved wallet with no customer present.
  - Log in with a PayPal sandbox **personal** (buyer) account.
- **Assumed:** whether the simulated customers pay. Each assumption has an ⓘ with its source; where no public benchmark exists, it says so.
- **Setup:** add `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` (REST sandbox app) to `.env`.

## Tests

```bash
npm test
```
