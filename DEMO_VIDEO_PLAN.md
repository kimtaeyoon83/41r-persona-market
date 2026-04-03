# 41R Persona Market — Demo Video Plan (60s)

## Overview

- **Target**: Under 60 seconds
- **Format**: Screen recording + subtitles (narration optional)
- **Tool**: OBS / QuickTime / Loom
- **Resolution**: 1920x1080, browser fullscreen
- **URL**: http://localhost:3000
- **Data reset**: `npx tsx scripts/seed-data.ts`

---

## Timeline

### Scene 1: Hook — "What is 41R?" (0:00 ~ 0:05)

**Screen**: Landing Page → http://localhost:3000
**Actions**:
1. Page loads → show Hero section
2. "AI Persona-Driven Product Validation" title + Live Stats (2 Active Tests, 5 AI Personas)
3. Briefly scan the pipeline flow

**Subtitle**:
> "41R turns real testers into AI Personas that autonomously validate your product on Solana."

---

### Scene 2: Company — Test Registration (0:05 ~ 0:13)

**Screen**: Company Dashboard → http://localhost:3000/company
**Actions**:
1. Show existing 2 tests (jup.ag, magiceden) on dashboard
2. Click "+ Register New Test" → registration page
3. Fill form (copy-paste from data below)
4. Click "Deposit USDC & Register Test"
5. Phantom approval → AI loading (Analyzing → Generating → Finalizing)
6. Redirect to test detail → show generated test cases

**Subtitle**:
> "Companies register a URL and deposit USDC. Claude AI generates structured test cases — checklist, scenarios, and questionnaire."

**INPUT DATA**:
| Field | Value |
|-------|-------|
| Company Wallet | *(auto-filled from Phantom)* |
| Target URL | `https://jup.ag` |
| Requirements | `Verify DeFi token swap accuracy — check that exchange rates match on-chain data, slippage protection works correctly, and fee calculations are transparent. Also audit for security vulnerabilities: wallet permission scoping, transaction simulation before signing, and protection against sandwich attacks.` |
| Budget (USDC) | `50` |
| Reward per Tester | `$5.0` |
| Enable AI Auto-Test | ✅ checked |

**Shortcut**: Skip registration, show existing jup.ag test detail from dashboard

---

### Scene 3: Tester Registration (0:13 ~ 0:20)

**Screen**: Tester Profile → http://localhost:3000/tester/profile
**Actions**:
1. Phantom wallet connected → address auto-filled
2. Click "Load" → "Not registered yet" → registration form appears
3. Fill profile data (see below)
4. Click "Register as Tester"
5. Registration complete → profile card shows (tests_done=0, Persona: Not yet)
6. Show "Complete 3 more test(s) to unlock AI Persona generation"

**Subtitle**:
> "Testers connect their wallet and register their expertise. After 3 tests, an AI Persona is generated."

**INPUT DATA**:
| Field | Value | Action |
|-------|-------|--------|
| Display Name | `Alex Kim` | type |
| Age Range | `20s` | dropdown |
| Region | `KR` | type |
| Occupation | `blockchain developer` | type |
| Expertise | `defi`, `web3` | click chips |
| Crypto Experience | `advanced` | dropdown |
| Experience Level | `expert` | dropdown |
| Preferred Domains | `defi`, `dao` | click chips |
| Primary Device | `Desktop` | click button |
| Design Matters? | `Yes` | click button |
| Frustration Triggers | `slow loading`, `unclear fees` | click chips |

---

### Scene 4: Tester — Manual Testing + USDC Reward (0:20 ~ 0:33)

**Screen**: Tester Tests → http://localhost:3000/tester/tests → pick jup.ag test
**Test ID**: `2592010a-11d1-4eb4-bb0c-030c33d02de1`

**Actions**: Fill checklist → scenario → questionnaire → submit → show result

**Subtitle**:
> "Testers complete structured tests and earn USDC rewards. A power-curve formula ties payout directly to report quality."

#### Checklist Input (4 items — click quickly)

| ID | Task | Status | Memo |
|----|------|--------|------|
| cl-1 | Connect a Phantom wallet to the DEX | **passed** | `Wallet connected instantly, address displayed in top-right corner` |
| cl-2 | Perform a token swap (SOL to USDC) | **passed** | `Swap executed in ~3s, balance updated, tx hash shown with Solscan link` |
| cl-3 | Check slippage settings modal | **failed** | `Custom slippage input accepts values above 50% without warning — potential MEV risk` |
| cl-4 | View transaction history | **passed** | `History loads correctly with timestamps and amounts` |

#### Scenario Input (1 item)

```
Swapped 2 SOL → USDC. Rate matched CoinGecko within 0.3%. Tried setting slippage to 99% — no warning shown, which is dangerous. Fee breakdown was clear before confirmation. Attempted providing liquidity but the pool page loaded slowly (~4s). Overall, swap UX is smooth but slippage guardrails need improvement.
```

#### Questionnaire Input (4 items)

| ID | Type | Input |
|----|------|-------|
| q-1 | rating 1-5 | **4** (click button) |
| q-2 | rating 1-10 | **7** (click button) |
| q-3 | free_text | `The slippage settings lack safety bounds. A new user could accidentally set 99% slippage and lose funds to MEV bots.` |
| q-4 | free_text | `Yes — Jupiter aggregates the best rates across DEXs which is a clear advantage. But I'd want slippage protection warnings before switching from Raydium.` |

#### Expected Result After Submit
- Quality Score: ~4.0–4.5/5.0
- USDC Reward: ~$3.6–$4.3 (power curve on $5 base)
- TX Signature: on-chain link
- Pause 2-3 seconds to show result

---

### Scene 5: Persona — AI Identity Generated (0:33 ~ 0:42)

**Screen**: Persona Gallery → http://localhost:3000/persona
**Actions**:
1. Show 5 persona cards in grid
2. Click DeFi Expert persona (Alice Chen — defi=0.98)
   → http://localhost:3000/persona/591f7a77-6a7b-4fa1-8b1d-e0b69e6e0c1d
3. Show radar chart (test_style 5-axis + expertise 5-axis)
4. Highlight persona vector + SAS attestation badge

**Subtitle**:
> "After 3 tests, an AI Persona is born — capturing the tester's unique testing DNA as an on-chain identity with SAS attestation."

**No input needed** — just click and scroll.

---

### Scene 6: Killing Moment — Auto Test Engine (0:42 ~ 0:55)

**Screen**: Auto Test → http://localhost:3000/autotest
**Actions**:
1. Select test and persona from dropdowns
2. Persona info card shows expertise tags
3. Click "Pay $0.10 & Run Auto Test"
4. Phantom approval → progress bar → result
5. Show: screenshot timeline, persona report, UX feedback, 41R settlement TX

**Subtitle**:
> "The AI Persona autonomously browses the site with Stagehand, tests real interactions, and generates a detailed report — settled with 41R tokens on Solana."

#### Dropdown Selections

| Field | Selection |
|-------|-----------|
| Select Test | `jup.ag (2592010a)` |
| Select Persona | `591f7a77 — defi (senior)` — Alice Chen |

#### Showing Results (pre-cached recommended)
Pre-run one auto test before recording, then show cached result:
1. Browser Session Timeline — expand 2-3 steps
2. Filmstrip Overview — scroll horizontally
3. Persona Report — scroll AI analysis
4. UX Feedback — 4 score cards
5. 41R Token Settlement — Solana Explorer link

---

### Scene 7: Closing — Tech Stack (0:55 ~ 1:00)

**Screen**: Landing page bottom or outro
**Actions**: Show "Powered by Solana" banner with tech badges

**Subtitle**:
> "Built on Solana — x402 micropayments, Token-2022 with 5% transfer fee, SAS attestation, and Claude AI."

---

## Quick-Copy Text Blocks

### Company Registration — Requirements
```
Verify DeFi token swap accuracy — check that exchange rates match on-chain data, slippage protection works correctly, and fee calculations are transparent. Also audit for security vulnerabilities: wallet permission scoping, transaction simulation before signing, and protection against sandwich attacks.
```

### Tester Registration
```
Display Name: Alex Kim
Region: KR
Occupation: blockchain developer
```

### Tester — Checklist Memos
```
cl-1: Wallet connected instantly, address displayed in top-right corner
cl-2: Swap executed in ~3s, balance updated, tx hash shown with Solscan link
cl-3: Custom slippage input accepts values above 50% without warning — potential MEV risk
cl-4: History loads correctly with timestamps and amounts
```

### Tester — Scenario Log
```
Swapped 2 SOL → USDC. Rate matched CoinGecko within 0.3%. Tried setting slippage to 99% — no warning shown, which is dangerous. Fee breakdown was clear before confirmation. Attempted providing liquidity but the pool page loaded slowly (~4s). Overall, swap UX is smooth but slippage guardrails need improvement.
```

### Tester — Questionnaire Free Text
q-3:
```
The slippage settings lack safety bounds. A new user could accidentally set 99% slippage and lose funds to MEV bots.
```
q-4:
```
Yes — Jupiter aggregates the best rates across DEXs which is a clear advantage. But I'd want slippage protection warnings before switching from Raydium.
```

---

## Pre-recording Checklist

### Servers
- [ ] API running: `curl localhost:4100/api/tests`
- [ ] Web running: open http://localhost:3000
- [ ] No zombie processes: `ps aux | grep 41rpm | grep -v grep | wc -l` (~4)

### Data
- [ ] Seed complete: `npx tsx scripts/seed-data.ts`
- [ ] 2 tests (jup.ag, magiceden)
- [ ] 7 testers (5 with personas, Diana has 3 tests but no persona, Evan has 0)
- [ ] 5 personas (all with SAS attestation)
- [ ] Auto test pre-run done (jup.ag + persona 591f7a77)

### Browser
- [ ] Phantom connected (devnet)
- [ ] Bookmarks bar hidden (Cmd+Shift+B)
- [ ] DevTools closed
- [ ] Zoom 110-120% (Cmd+=)
- [ ] Dark theme active
- [ ] Close all other tabs

---

## Key URLs (demo order)

| Scene | URL |
|-------|-----|
| 1. Landing | http://localhost:3000 |
| 2. Company Dashboard | http://localhost:3000/company |
| 2b. Register | http://localhost:3000/company/register |
| 3. Tester Register | http://localhost:3000/tester/profile |
| 4. Test List | http://localhost:3000/tester/tests |
| 5. Persona Gallery | http://localhost:3000/persona |
| 5b. Persona Detail | http://localhost:3000/persona/591f7a77-6a7b-4fa1-8b1d-e0b69e6e0c1d |
| 6. Auto Test | http://localhost:3000/autotest |

---

## Key Demo Data

| Item | Value |
|------|-------|
| jup.ag Test ID | `2592010a-11d1-4eb4-bb0c-030c33d02de1` |
| DeFi Expert Persona | `591f7a77` — Alice Chen, defi=0.98 |
| Security Persona | `b74d749f` — Charlie Nakamura, defi=0.9 |
| UX Persona | `7d4008eb` — Grace Park |
| Live registration | New wallet → Alex Kim |
| Diana Okafor | tests_done=3, no persona → can generate live |

---

## Speed Run Version (45s)

- Cut Scene 2 to 5s: show dashboard cards only
- Cut Scene 3: skip tester registration entirely

## Recording Flow

1. **Rehearse** — run through with timer
2. **Record** — one continuous take
3. **Edit** — add subtitles + 2x speed on loading
