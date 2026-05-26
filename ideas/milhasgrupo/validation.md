# MilhasGrupo — Validation One-Pager

> Framework: Zero to Sold (Kahl) — Preparation Stage
> Status: Hypothesis

---

## 0. Core Assumption (the ONE thing being tested)
**If Brazilian upper-middle-class families with miles can be reached via paid ads at CAC < R$ 300 AND convert from alert to issuance at > 30%, the business works. If false, kill.**

---

## 1. Audience
**Niche:** Brazilian upper-middle-class families (kids 6-15) accumulating miles 3+ years, planning Disney/Orlando in next 8-18 months.
**Persona:** Camila, 41, senior manager, R$ 30K household income, 3 black-tier cards, lives in SP/BH.
**Size:** ~500K Brazilian families accumulate miles; 50-100K have Disney/Orlando as 2-year goal.
**Tribal signals:** Disney Facebook groups, blogs (Vai pra Disney, Disney com Milhas), school WhatsApp groups.

## 2. Problem
**One sentence:** Families with enough miles can't issue 3-6 tickets on the same flight because airlines release only 2-6 award seats per flight, shared across global programs.

**Critical filters:**
- [x] Ignoring lowers quality of life (dream trip lost or paid R$ 30-50K cash)
- [x] Intersection of mandatory + wasteful (fixed school holidays + 30-80h research)
- [x] Want to opt out, can't (miles expire, cash premium is brutal)
- [x] Repetitive / takes long every time (3-6 months of daily searches)
- [x] Solution-aware with own workarounds (spreadsheets, alert groups)

**Will they pay?**
- Saves time: yes, 30-80h → 10 min onboarding
- Saves money: yes, R$ 10-15K average per family trip
- Makes money: indirect, expiring miles get used

## 3. Solution Hypothesis
| Today | With MilhasGrupo |
|---|---|
| 5 generic alert groups, 30 alerts/day | 1 target trip, 1-3 relevant alerts/week |
| Manual search across multiple programs | Cross-references programs where she has balance |
| Tries to issue N seats, system denies | Alerts only when N seats confirmed |

## 4. Prototype Scope (hard constraints)
**Does:**
1. Registration form for ONE target trip (origin, dates, group size, programs)
2. Monitor availability on Azul Fidelidade + LATAM Pass + Smiles
3. Telegram/email alert with booking link + action playbook

**Does NOT:**
- Other destinations (only MCO/Orlando)
- Other origins (only GRU, CNF, VCP — direct flights only)
- Other programs (no AAdvantage, Livelo, TAP)
- Group sizes outside 3-6
- Dashboard, login, mobile app

**Stack:** Tally + Google Sheets + Telegram bot + Carrd landing. Build: 1-2 days (well under 5-day Sprint ceiling).

## 5. Validation via Paid Traffic

**4 questions to validate:**
1. Problem exists? (registration rate)
2. Solution resonates? (post-registration engagement)
3. Audience reachable via paid channels? (CTR, CPM)
4. CAC fits the model? (cost per qualified lead)

**Budget:** R$ 2,000-3,000 over 2-3 weeks.

**Channels (run in parallel):**
- Meta Ads — women 35-50, high income, Disney/family travel interests
- Google Ads — "disney com milhas", "milhas para orlando", "passagem família orlando"

**Landing form (4 fields):**
1. Email
2. WhatsApp/Telegram
3. Family size (3, 4, 5, 6+)
4. Travel window (next 6mo / 6-12mo / 12-18mo / planning)

**Funnel targets:**
| Stage | Healthy | Death |
|---|---|---|
| CTR | > 1.5% | < 0.5% |
| Bounce | < 60% | > 80% |
| Landing → Lead | > 5% | < 1% |
| Lead → Active | > 60% | < 30% |
| Active → Issuance | > 30% | < 10% |

**Unit economics:**
- Projected LTV: R$ 1,500
- Max viable CAC: R$ 300-400
- Validation CAC ceiling: R$ 200 per qualified lead

**Decision matrix:**
| CAC | Lead → Active | Decision |
|---|---|---|
| < R$ 100 | > 70% | Accelerate |
| R$ 100-200 | 50-70% | Continue, optimize |
| R$ 200-300 | 30-50% | Iterate landing/creatives |
| > R$ 400 | < 30% | Kill or pivot |

## 6. Foundational Choices
| Decision | Choice | Reason |
|---|---|---|
| Audience scope | Families w/ kids, large international trip | Tribal, high willingness to pay |
| Beachhead | Disney/Orlando | Mature community, documented pain |
| Revenue model | Subscription, free during beta | Recurring + learning > early revenue |
| Positioning | Specialist (not generalist) | Defense against Flypass/PP |

## 7. Go / No-Go (week 4)

> **Kill criteria written BEFORE spending R$ 1. Non-negotiable.**

**GO:**
- [ ] CAC < R$ 300
- [ ] Landing → Lead > 5%
- [ ] 15+ active beta users from 20 spots
- [ ] 5+ confirmed issuances (alert → booking)

**PIVOT:**
- High traffic, low conversion → message wrong
- High conversion, low engagement → product wrong
- High engagement, no payment → pricing wrong

**KILL:**
- CAC > R$ 400 across both channels (per-channel: kill the channel at R$ 500)
- Lead → Active < 30%
- < 3 issuances in 8 weeks
- Landing → Lead conversion < 1% after 2 creative iterations

## 8. Execution (5-day build, per Sprint rule)
- **Day 1-2:** Build landing + Tally form + Telegram bot
- **Day 3:** Pixel/UTM + 3 creatives per channel
- **Day 4:** Launch Meta + Google ads
- **Day 5:** First metrics review, kill bad creatives
- **Days 6-28:** Operate, measure, iterate. Go/No-Go on day 28.

## 9. Risks
1. Scraping/manual monitoring fragility on airline sites
2. Paid traffic cohort converts worse to paid than organic (run small organic in parallel)
3. Scope creep — adding GIG or other destinations before validation completes

---
**Current status:** Scope locked, ready to build.
**Next gate:** Ship prototype + launch ads within 5 days. Go/No-Go on day 28.
