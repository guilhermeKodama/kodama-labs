# FIRE-BR — Validation One-Pager

> Framework: Zero to Sold (Kahl) — Preparation Stage
> Status: Hypothesis
> Working name: *(TBD — e.g. "Marco", "Rumo")*

---

## 0. Core Assumption (the ONE thing being tested)
**If Brazilians actively pursuing FIRE can be reached via paid ads at a qualified-lead cost that fits the model AND show willingness to pay for a Brazil-localized planning tool (vs. their free spreadsheet/calculator), the business works. If they're satisfied with free tools OR the niche is too small/expensive to reach, kill.**

> This doc tests THAT. Not "the pain exists" (the FIRE-BR community itself already says linear spreadsheets don't model Brazil) nor "can it be built" (known category + reusable Capital base). It tests **real demand + willingness to pay + reachability**.

---

## 1. Audience
**Niche:** Brazilians in the **accumulation phase** toward financial independence who **already invest** across multiple assets and currently plan in spreadsheets — not beginners, not the indebted. Often PJ/tech professionals with part of their portfolio in USD.
**Persona:** Rafael, 36, senior dev/PJ, R$ 25-40K household income, invests in FIIs + dollar (BDR/US ETFs), runs his own FIRE spreadsheet he's never satisfied with.
**Size:** FIRE-BR is a niche-within-a-niche but growing among young high-earning professionals. Addressable subset to be validated via ad reach/CPM and FIRE search volume. **(TAM = top risk.)**
**Tribal signals:** AposenteAos40 (AA40), dividend/FII communities, FIRE forums on X/Reddit, finance creators (Ulrich, Os Sócios, Rian Tavares, Raul Sena), users of Status Invest/Kinvo and of the US tool ProjectionLab.

## 2. Problem
**One sentence:** Brazilians pursuing FIRE plan a 10-30 year journey in linear spreadsheets that don't model Brazilian reality (IPCA/Selic swings, local taxation, tax-free FIIs, dollar assets) or track progress — while the good planning tool (ProjectionLab) is built for US taxes and the free Brazilian options are shallow one-shot calculators.

**Critical filters** (check all that apply):
- [x] Ignoring lowers quality of life (mis-planning delays freedom by years)
- [x] Intersection of mandatory + wasteful (maintaining the spreadsheet every month)
- [x] Want to opt out, can't (need to know if they're on track)
- [x] Repetitive / takes long every time (re-projecting on every scenario change)
- [x] Solution-aware with own workarounds (spreadsheet, Notion, free calculators)

**Will they pay?**
- Saves time: yes — ends spreadsheet maintenance and manual re-calc
- Saves money: indirect — better decisions (contribution order, assets, withdrawal) speed up the goal
- Makes money: no — value is clarity + confidence + motivation ("am I on track?")

## 3. Solution Hypothesis
**Workflow change (today → with us):**
| Today | With FIRE-BR |
|---|---|
| Linear spreadsheet, fixed return, ignores IPCA/Selic/local cycles | BR-grounded projection + scenarios + uncertainty simulation |
| No BR taxation, tax-free FIIs, or dollar assets modeled | Real Brazilian asset classes & taxes + BRL/USD |
| "When can I stop?" is a guess | FI number + date, updated as you contribute |
| Loses motivation over a 20-year goal | Long-term → quarterly milestones with visual progress |

## 4. Prototype Scope (hard constraints)
> The 5-day build is the **validation prototype** (landing + interactive hook + waitlist), **not** the full product.

**Does (3 parts):** landing · interactive FIRE-date hook · waitlist + price probe.

**Lead flow (step by step):**
1. **Ad → click.** One of the 3 creative angles (pain / aspiration / gringo-gap) drives to the landing.
2. **Landing — frame the gap, no form yet.** Headline + 2 lines ("your spreadsheet doesn't model Brazil; ProjectionLab is built for the US"). Single CTA: *"Find out your independence date"* → drops them straight into the calculator. Zero friction, no email asked.
3. **Calculator — the hook.** Only 3-4 inputs: monthly expenses, invested net worth, monthly contribution, (optional) % in dollar. Brazilian assumptions pre-filled (IPCA, CDI/Selic, 4% rule) so it's instant. No signup.
4. **Teaser result — value first, ungated.** Headline number: *"At this pace you reach independence in ~X years (in 20XX)."* The "Aha" is given for free to earn trust (this audience is privacy-sensitive and prefers no-login tools). The fuller chart + scenario breakdown sit **locked/blurred** right below it.
5. **Capture — at peak interest.** *"Want the full picture — optimistic/realistic/pessimistic scenarios, tax impact, and to track this number month to month? Join the list."* The 4-field form appears **here**, right after they've seen their own number. → **this is the contact (lead).**
6. **Paid-intent probe (fake door).** The result/confirmation also shows *"Full plan: R$ X/mo"* with an *"I want the plan"* button. Clicking → *"We're in beta — you're on the priority list + X months free at launch."* The **click is the willingness-to-pay signal** — behavior, not a survey answer (golden rule: count behavior).
7. **Confirmation.** Sets expectation (notified at launch) + optional Telegram/community invite to keep leads warm and enable Mom Test follow-ups.

> **Why value-first (ungated):** gating the FIRE date behind an email wall would kill trust with a finance/privacy-sensitive audience and conflate two signals. Giving the number free lets us measure **engagement** (did the value land?) separately from **demand** (did they join?) — and the fake-door price click measures **WTP** as behavior, not opinion.

**Three behavior-based signals it produces** (map to the funnel): **engagement** = % who complete the calculator · **lead** = % who join the list · **paid intent** = % who click the price.

**Does NOT:**
- Full scenario engine / Monte Carlo
- Milestone tracking / dashboard
- Login, payment, account syncing
- Complex multi-currency, withdrawal optimization

**Stack:** reuse Capital's components + Next.js/Vercel landing; native form or Tally; Pixel (Meta) + gtag/Conversion Action (Google). **Build: well under the 5-day Sprint ceiling.**

## 5. Validation via Paid Traffic

**4 questions to validate:**
1. Problem exists? (registration rate)
2. Solution resonates? (FI-calc completion / post-registration engagement)
3. Audience reachable via paid channels? (CTR, CPM)
4. CAC fits the model? (cost per qualified lead)

**Budget:** R$ 2,000-2,500 over 3-4 weeks.

**Channels (run in parallel):**
- Meta Ads — financial-independence / dividends / FII interests (demand creation)
- Google Ads — "calculadora FIRE", "independência financeira", "aposentadoria antecipada" (demand capture)

**Landing form (max 4 fields — appears at step 5, after the teaser result):**
1. Email
2. Stage (accumulating / almost there / already living off income)
3. Invested net worth band
4. Biggest difficulty today (spreadsheet / knowing if on track / taxes / other)

**Funnel targets:**
| Stage | Healthy | Death |
|---|---|---|
| CTR | > 1.5% | < 0.5% |
| Bounce | < 60% | > 80% |
| Landing → Active (completes calc) | > 30% | < 10% |
| Active → Lead (joins list) | > 30% | < 10% |
| Lead → Paid intent (clicks price) | > 30% | < 10% |

**Unit economics:**
- Projected LTV: R$ 480 (subscription, long retention over the FIRE journey)
- Max viable CAC: R$ 120 (LTV/CAC ≥ 4:1)
- Validation CAC ceiling: R$ 50 per qualified lead

**Decision matrix:**
| CAC | Lead → Active | Decision |
|---|---|---|
| < R$ 30 | > 70% | Accelerate |
| R$ 30-60 | 50-70% | Continue, optimize |
| R$ 60-100 | 30-50% | Iterate landing/creatives |
| > R$ 120 | < 30% | Kill or pivot |

## 6. Foundational Choices
| Decision | Choice | Reason |
|---|---|---|
| Audience scope | Niche FIRE-BR (accumulators who already invest) | Where pain + WTP + reach intersect; avoids commoditized generic personal finance |
| Beachhead | Engaged accumulators, entry via dollar/multi-asset tribe (founder's own profile) | Where BR localization + multi-currency hurts most and ProjectionLab/free calculators serve least |
| Revenue model | Subscription (annual preferred), free during beta | Recurring + matches long journey + proven by ProjectionLab |
| Positioning | "The FIRE planner built for Brazil" | Owns the gap between shallow free calculator and US-built tool |

## 7. Go / No-Go (week 4)

> **Kill criteria written BEFORE spending R$ 1. Non-negotiable.**

**GO:**
- [ ] Qualified-lead cost within ceiling (< R$ 60 on at least one channel)
- [ ] Funnel signals healthy (completes calc > 30%, joins list > 30%)
- [ ] Paid-intent signal > 30% of leads

**PIVOT:**
- High traffic, low conversion → message wrong
- High conversion, low engagement → product wrong
- High engagement, no payment → pricing wrong

**KILL:**
- CAC > R$ 120 across both channels (per-channel kill at R$ 150)
- Lead → Active < 30%
- Landing → Lead < 1% after 2 creative iterations
- Can't reach the audience at viable cost → TAM too thin (top risk)

## 8. Execution (5-day build, per Sprint rule)
- **Day 1-2:** landing + FIRE-date hook (reuse Capital components)
- **Day 3:** tracking (Pixel + gtag/Conversion Action; verify firing in Tag Assistant)
- **Day 4:** launch Meta + Google (3 creatives per channel)
- **Day 5:** first metrics review, kill bad creatives
- **Days 6-28:** operate, measure, iterate. Read data only +72h. Go/No-Go on day 28.

## 9. Risks
1. **Thin TAM** — FIRE-BR is small; may not reach enough people at viable cost (risk #1, exactly what validation measures).
2. **Free-calculator behavior** — audience may be satisfied with spreadsheets/free calculators and refuse to pay.
3. **Founder bias** — you ARE the persona; don't mistake passion for market signal. Mom Test only with other FIRE-BR people, never yourself.

---
**Current status:** Hypothesis defined. Top risk = TAM + WTP, both testable via paid traffic.
**Next gate:** 5-day build → 3-4 weeks of traffic → Go/No-Go on day 28.