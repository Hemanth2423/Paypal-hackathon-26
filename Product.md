# SecondMint: Product Spec

v0.5 · submission due Nov 12, 2026, 12:00pm

> First we show you where you're losing money. Then we prove whether PayPal gets it back.

## 1. Problem
SaaS merchants lose recurring revenue when renewal payments fail. Most run a fixed retry schedule they set up years ago and never measured. When PayPal pitches Smart Retries, the merchant has no way to check the claim on its own customers. It also doesn't know which failures its current process is mishandling. So the deal stalls at "prove it."

## 2. Who it's for
- **Primary: the merchant's billing or revenue-ops lead.** They own failed-payment recovery and have to justify a processor change to finance. They need to see their own numbers, not industry averages.
- **Secondary: the PayPal account executive.** They need a low-risk way to move a merchant from free trial to Enterprise. A trial with a clear verdict is worth more than a case study.

## 3. Solution
SecondMint has two steps.
1. **Leak Diagnostic (free).** It reads the merchant's payment history and shows where failed renewals lose money, which failures can be recovered, and how well the current process recovers them.
2. **Recovery Trial.** It splits customers into two groups up front and sends each group through a different payment route (current process vs. PayPal). It then reports which route recovered more net revenue. The verdict can be "inconclusive."

SecondMint measures recovery. It does not recover payments itself.

## 4. Goals and non-goals
**Goals**
- A merchant understands its failure modes within 5 minutes of connecting.
- A merchant gets a verdict it trusts, stated in dollars, with the uncertainty shown.
- Judges can run every step end to end on Braintree sandbox data.

**Non-goals**
- Building a better retry algorithm than PayPal's.
- Claiming real-world PayPal performance numbers.
- Production onboarding (OAuth, accounts, billing).

**How we'd know it works (post-hackathon):** the share of diagnostics that become trials, the share of trials that reach a verdict, and the share of "PayPal wins" verdicts that convert to Enterprise.

## 5. Trial design: route-based split
There is no public API switch for turning Smart Retries on for some customers and off for others. We avoid needing one. Smart Retries is set per merchant account, so we assign customers to a route before the trial starts:

| | Route A: Current | Route B: PayPal |
|---|---|---|
| Who | 50% of eligible customers, chosen at random | The other 50% |
| Where renewals run | The merchant's existing process | A Braintree merchant account with PayPal recovery |
| Automatic retries | The merchant's existing schedule | Smart Retries (production) or a Smart Retries–style policy (prototype) |
| Everything else (failures in scope, customer messaging, payment methods) | Identical | Identical |

Each customer stays on one route for the whole trial, so no invoice is retried by both routes.

**Why this works:** the merchant is really deciding whether to move recovery to PayPal, and this design measures that decision directly. Only the retry logic differs between routes, so the comparison is like for like. One limit remains: in production the result covers the whole PayPal route (processor and retries together), not Smart Retries alone. The report says so.

**What's real vs. simulated in the prototype**
- **Real:** both routes are separate Braintree sandbox merchant accounts. Every customer, card, subscription, and payment attempt is created in and read back from the sandbox.
- **Simulated:**
  - **Bank decisions.** The sandbox decides success or decline from the amount sent, not from timing, so a documented model picks each attempt's outcome and we send the matching sandbox test amount.
  - **Route B's retry timing.** Smart Retries may not run in sandbox, so our app applies a Smart Retries–style policy.
  - **The calendar.** The sandbox can't backdate transactions, so each transaction carries its simulated billing date in a custom field.
- The app shows these labels on screen, not just in the README.

## 6. Metric definitions
- **Eligible failure:** a failed renewal with a soft (retryable) decline, whose first failure falls inside the trial window.
- **Recovered:** collected within the recovery window (default 14 days) by the customer's assigned route.
- **Recovery rate** = recovered ÷ eligible, per route.
- **Net recovered $** = recovered $ − retry costs − network excess-retry fees − refunds and chargebacks in the window.
- **Saved subscriptions:** recovered invoices whose subscription is still active at the end of the window.

## 7. UX standards (apply to every screen)

### Visual system
It follows PayPal's own product UI so the app feels native to PayPal merchants. These tokens are defined once and used everywhere; no one-off styles.

| Token | Value / rule |
|---|---|
| Primary navy | Deep PayPal navy: top nav background, headings, and filled primary buttons |
| Action blue | Bright PayPal blue: links, secondary buttons, selected states, focus rings |
| Accent yellow | PayPal yellow: one high-priority action per screen at most, and check icons in lists |
| Backgrounds | A warm off-white page, with white cards on top |
| Text | Navy for headings, near-black for body, mid-grey for helper text |
| Type | A clean geometric sans close to PayPal Sans. Large, light-weight page titles; a short subtitle under each title |
| Buttons | Fully rounded pills. Primary: filled navy. Secondary: blue outline on white. Tertiary: blue text link |
| Cards | White, 16px corner radius, a thin light-grey border or soft shadow, generous padding |
| Selectable options | Full-width cards with an icon in a soft circle, a title, one line of description, and a right arrow |
| Inputs | Floating labels inside a thin bordered box; helper text below in grey |
| Navigation | A navy top bar with the logo on the left and text tabs; the active tab is a lighter pill |
| Layout | Dashboards use a 2-column layout (main content + right action rail). Setup flows use one centered column, max 480px wide |
| Status colors | Green for recovered, amber for in progress, red for lost. Always paired with a text label |

### Interaction and content rules
- [ ] **Headline first:** each screen opens with the one number or verdict that matters, then the detail behind it.
- [ ] **Units are always clear:**
  - Money shows its currency, with two decimals in tables and rounded figures in headline tiles.
  - Rates are shown as % with one decimal.
  - Every metric has a hover definition taken from section 6.
- [ ] **Data source is always clear:** a persistent banner shows "Sandbox data · simulated outcomes," and each figure links to the transactions behind it.
- [ ] **Every data view has four designed states:** loading (skeleton), empty, error (with a retry action), and success. No blank screens and no raw error text.
- [ ] **Accessible:** WCAG 2.1 AA contrast, full keyboard navigation, and charts that never rely on color alone.
- [ ] **Responsive:** built for 1280px; still readable at 768px.
- [ ] **Plain language:** decline codes are always paired with a plain name (e.g. "2001 · Insufficient funds"). Sentences are short, in the second person.
- [ ] **Branding:** "Built on PayPal" branding only. Nothing implies this is an official PayPal product.

## 8. Features and acceptance criteria

### F1. Connect merchant
- [ ] A seed script creates the demo merchant in the Braintree sandbox:
  - ≥ 1,000 customers with vaulted test cards and subscriptions
  - failed and recovered renewal attempts
  - a decline mix covering 2000, 2001, 2004, 2015, 2046, and 3000, set in one config file
- [ ] The app reads all diagnostic data back through the Braintree transaction search API. No dashboard number comes from a local file.
- [ ] **Connect screen:**
  - one "Connect sandbox merchant" action
  - a progress indicator showing record counts as they load
  - a summary card when done (customers, transactions, date range)
- [ ] If credentials fail, the screen says which credential is wrong and how to fix it.

### F2. Leak Diagnostic dashboard
**Layout, top to bottom**
1. **KPI row:**
   - failed revenue (last 90 days)
   - recoverable revenue
   - current recovery rate
   - revenue lost to hard declines

   Each tile shows the change vs. the prior 30 days.
2. **Where the money leaks:** horizontal bar chart of failed $ by decline reason, sorted largest first, with count and share of total on each bar.
3. **Recoverable vs. not:** soft vs. hard split. Links to the classification rules (Braintree categories plus Visa/Mastercard retry limits).
4. **How the current process performs:** recovery rate by decline reason, against the overall rate. Reasons with below-average recovery are flagged.
5. **Waste:** hard declines that were retried, attempts beyond network limits (e.g. Visa > 15 in 30 days), and the estimated excess fees.
6. **What's at stake:** recoverable MRR per month, and a trial-length estimate ("a 3-week trial can detect a ≥ X pp uplift at 80% power").
7. **AI summary:** at most 150 words on the top 3 leaks. Every number in it must match a tile or chart.
8. **Failures table:** sort, filter, group by reason or route, and click through to the attempt history of any invoice.

**Behavior**
- [ ] Global filters (date range, decline reason, card brand, plan) update every section of the dashboard at once.
- [ ] Clicking a bar or KPI filters the table to the matching rows.
- [ ] **Export CSV** exports the current filtered view, one row per failed invoice, with these columns:
  - **Invoice and customer:** `invoice_id, subscription_id, customer_id, plan_id, route, merchant_account_id`
  - **Amounts and dates:** `amount, currency, billing_date_simulated, first_failed_at, braintree_transaction_ids`
  - **Card:** `card_brand, card_type, card_last4`
  - **Decline details:** `processor_response_code, processor_response_text, merchant_advice_code, decline_type (soft/hard), network_retry_category`
  - **Retry attempts:** `attempt_count, first_attempt_at, last_attempt_at, attempts_over_network_limit, estimated_excess_fees`
  - **Outcome:** `status (recovered/unrecovered/excluded/in_window), recovered_at, days_to_recover, recovered_amount, refunded_amount, net_recovered_amount`
  - **Provenance:** `subscription_status_end, data_source, outcome_simulated (true/false), exported_at`
- [ ] The CSV opens cleanly in Excel and Google Sheets (UTF-8, ISO dates, no thousands separators in numbers), and its row count matches the table.
- [ ] The dashboard loads in under 3 seconds for 1,000 customers after the first sync.

### F3. Trial setup and readiness
- [ ] Setup is a 3-step flow in a centered single column, with progress shown: configure → review groups → readiness.
- [ ] **Configure:** trial length (default 21 days), recovery window (default 14 days), and split (default 50/50). Each field shows how it affects the trial's power estimate.
- [ ] **Assignment:** random and sticky per customer (hash of customer ID + trial seed). A balance table compares the two routes on count, $, decline mix, and plan mix, and warns if any difference exceeds 5%.
- [ ] Hard declines are excluded from both routes and listed with the reason.
- [ ] **Readiness checklist:** "Start trial" stays disabled until every item is checked, and its tooltip names any unchecked items. Items:
  - merchant consent and terms
  - data-access scope
  - early-stop rules (e.g. stop if Route B is significantly worse, or complaints pass a threshold)
  - one route per invoice

### F4. Run trial
- [ ] Route A replays the merchant's existing schedule (e.g. every 3 days, 4 times, all decline codes).
- [ ] Route B runs a Smart Retries–style policy: no hard-decline retries, code-aware timing, and attempts capped by network rules.
- [ ] Every attempt is a real Braintree sandbox call, logged to an outcome ledger with: invoice, route, attempt #, simulated time, code, result, and fee.
- [ ] Duplicate collections are counted and must be 0. The count is shown.
- [ ] A fast-forward plays 21 simulated days in under 60 seconds. A live timeline shows attempts per route, and the run can be paused.

### F5. Results report
- [ ] **Headline:** the verdict, plus the net recovered $ difference between routes.
- [ ] The verdict comes from rules, not the AI:
  - "PayPal route wins" if the 95% CI lower bound of the uplift is > 0 and net $ is > 0
  - "Current route wins" if the CI upper bound is < 0
  - otherwise "Inconclusive: extend the trial"
- [ ] **Side-by-side table:** eligible, recovered, recovery rate, recovered $, costs and fees, refunds, net $, and saved subscriptions.
- [ ] Shows uplift in pp and %, the 95% CI, and the p-value. The breakdown by decline reason shows where the difference came from.
- [ ] **Exports:**
  - a one-page PDF that carries the real-vs-simulated labels
  - a results CSV using the F2 schema

### F6. AI analyst
- [ ] A right-rail panel is available on every screen and answers questions by querying the ledger and diagnostic data.
- [ ] Each answer cites the metrics it used and links to the matching filtered view.
- [ ] When the data can't answer, it says so. It never states real-world PayPal performance (tested with ≥ 3 adversarial prompts).
- [ ] It writes the report summary, which must match the rule-based verdict.
- [ ] Suggested questions are shown when the panel is empty (e.g. "Which decline reason drove the uplift?").

## 9. PayPal capabilities used
- **Braintree sandbox:** customers, the payment-method vault, subscriptions, transaction sale and search, processor response codes, and merchant accounts per route.
- **Positioned as the production treatment:** Smart Retries, and network retry guidance.

## 10. Out of scope
- Real merchant OAuth and user accounts.
- Moving stored cards from another processor (they aren't portable to Braintree).
- Native Smart Retries toggling.
- Account updater.
- Customer-assisted recovery (card-update pages, PayPal wallet fallback): it would add a second factor and break the like-for-like retry comparison. Planned for v2 (section 13).
- Multi-currency.

## 11. Assumptions and risks
| Assumption or risk | If wrong | Mitigation |
|---|---|---|
| Sandbox allows two merchant accounts (one per route) | Routes collapse into one account | Tag the route on each transaction instead |
| Custom fields can carry simulated dates | The timeline looks like it all happened today | Store dates in our ledger, keyed by transaction ID |
| 1,000 customers gives enough power to reach a verdict | Every demo run ends "inconclusive" | Show the power estimate; tune the seed size |
| Production cards on another processor can't move to Braintree | Route B can't charge Route A's customers | Vault migration is part of real onboarding (out of scope) |

## 12. Demo script (under 3 minutes)
1. **Problem (15s):** failed renewals quietly cost SaaS merchants MRR.
2. **Diagnostic (50s):** KPIs, the biggest leak, wasted retries, the AI summary, and a CSV export.
3. **Trial (40s):** route split, balance check, readiness, and fast-forward.
4. **Results (45s):** verdict, net $, and where the gain came from (asked to the AI).
5. **Close (10s):** what's real, what's simulated, and the path to production.

## 13. v2: PayPal wallet as a third arm
Add **Route C: PayPal + wallet**. It is Route B plus a payment-update page that offers Pay with PayPal, with the wallet vaulted for future renewals.

| Comparison | What it isolates |
|---|---|
| B vs. A | Retry logic (and processor, in production) |
| C vs. B | The added value of the PayPal wallet fallback |
| C vs. A | The full PayPal offer vs. today |

Detailed requirements will be defined after the v1 build is complete.
