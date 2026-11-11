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

## What's real and what's simulated

- **Real:** every customer, card, subscription, and payment attempt is created in and read back from the Braintree sandbox.
- **Simulated:** the bank's decision. The sandbox declines or approves based on the amount sent, so a seeded outcome model (see `config/seed.config.ts`) picks each outcome, and the matching test amount is sent. Billing dates are simulated too, and are stored in custom fields.

## Tests

```bash
npm test
```
