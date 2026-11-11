# SecondMint: operating rules

PayPal AI Hackathon project. Specs: [Product.md](Product.md) (what and why), [TechSpec.md](TechSpec.md) (how).

## Hard rules
- **$0 cost.** Use only sandboxes, free tiers with no billing account attached, and open-source libraries. Never add a paid plan, a billing account, or a card. If a free tier runs out, the feature degrades (cached result or template fallback); it never upgrades.
- **Secrets only in `.env`.** It is gitignored. Secrets are read on the server only, never sent to the browser, and never written into code, docs, logs, or commits. `.env.example` is the committed template with empty values.
- **No merge or push without the user's explicit OK**, and commit only when the user asks.

## Workflow (SDLC)
1. Product.md approved → TechSpec.md approved → build.
2. Build one feature at a time (F1…F6). Stop after each one and report crisply: what's built, what's verified, any gaps.
3. The user reviews and tests every flow before the next feature starts.
4. A feature is done only when its Product.md acceptance criteria are checked off.

## Hackathon constraints (Devpost)
- Due **Nov 12, 2026, 12:00pm**.
- Must meaningfully use a PayPal technology (Braintree counts) **and** AI.
- Judges need a hosted demo URL or full run instructions.
- Public repo with an MIT `LICENSE` at the root.
- Demo video under 3 minutes on YouTube, with no third-party copyrighted material.
- The README must have a "Tools used" section explaining each AI/model tool.
- Sponsor tools in use: AG Grid Community (tables), Render free tier (hosting).

## Free-tier facts to respect
| Service | Plan | Limits that matter |
|---|---|---|
| Braintree sandbox | Free | No published rate limit; we cap at 8 parallel calls. Account has one merchant account (`ucb`). |
| PayPal REST sandbox | Free | Reserved for the v2 wallet arm. |
| Gemini (AI Studio) | Free tier, key with no billing | Low daily request caps (check AI Studio). Cache every AI result; template fallback. |
| Render | Free web service | Sleeps after ~15 minutes idle (30–50s cold start); disk resets on restart. |

## Conventions
- **Honesty labels:** every screen using simulated outcomes shows "Sandbox data · simulated outcomes."
- **Visual tokens:** live only in `src/app/globals.css` (Product.md §7).
- **Seed settings** (plans, decline mix, outcome model): live only in `config/seed.config.ts`.
- **Diagrams:** made with the vendored `draw-diagram` skill (`.claude/skills/draw-diagram`). Sources go in `docs/diagrams/*.drawio`, and rendered PNGs sit next to them.
