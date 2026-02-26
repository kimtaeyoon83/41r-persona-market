# 41R Persona Market — Demo Script (4 minutes)

## Pre-demo Setup

```bash
# Ensure PostgreSQL is running
docker start 41rpm-postgres

# Seed fresh data
npx tsx scripts/seed-data.ts

# Start servers
pnpm dev
# API: http://localhost:4100
# Web: http://localhost:3100
```

Open browser to `http://localhost:3100`

---

## Scene 1: The Problem (30s)

**[Show landing page]**

> "Product testing is broken. Companies pay $49 per session on UserTesting, wait 2 weeks for results, and can't reuse testers. International testers wait weeks for bank transfers."

> "41R Persona Market fixes this with AI Personas on Solana."

---

## Scene 2: Company Registers a Test (45s)

**[Click "For Companies" > "Register Test"]**

1. Enter URL: `https://demo-dex.app`
2. Enter requirements: "Full UX audit of token swap interface"
3. Enter budget: `500` USDC
4. Enter wallet: `DemoCompany111...`
5. Click **Register Test**

> "The company submits a URL. Claude Sonnet analyzes the site and auto-generates three types of test cases: a structured checklist, user scenario narratives, and a UX questionnaire."

**[Show test detail page with generated test cases]**

---

## Scene 3: Tester Completes a Test (60s)

**[Navigate to Tester > Available Tests]**

1. Click on the DEX test
2. **[Show test execution page]**
3. Walk through:
   - Toggle checklist items (passed/failed/blocked) with notes
   - Type scenario observations in the timeline textarea
   - Rate questionnaire items (1-10 scale + free text)
4. Click **Submit Test Report**

> "Testers execute the test cases, recording results for each checklist item, scenario, and question. On submission, Claude Haiku instantly scores quality 1-5, and USDC $3-$5 is transferred to their Solana wallet — no bank delays."

**[Show submission result: quality score, USDC amount, TX signature]**

---

## Scene 4: Persona Generation (60s)

**[Navigate to Tester > Profile, look up Alice's wallet]**

> "After completing 3 tests, the tester's AI Persona is automatically generated."

**[Navigate to Persona Gallery]**

1. Show 3 personas in the gallery (Alice, Bob, Charlie)
2. Click on Alice's persona

**[Show Persona Detail page]**

> "Claude analyzes all 3 reports to create a 20-dimension Persona Vector. Four radar charts visualize Test Style, Expertise, Feedback Pattern, and Reliability."

3. Point out radar charts:
   - Test Style: high speed + thoroughness (Alice is metrics-driven)
   - Expertise: 95% DeFi, 40% NFT (Alice is a DeFi expert)
   - Feedback: detail-oriented, performance-sensitive
   - Reliability: Gold tier — 4.5 quality, 95% response rate

> "This Persona is attested on-chain via SAS — anyone can verify Alice's Gold tier credentials on Solana Explorer."

**[Point to SAS badge]**

---

## Scene 5: Auto Test — The Killing Moment (45s)

**[Navigate to Auto Test page]**

1. Select test: `demo-nft.app`
2. Select persona: Alice (matched by expertise)
3. Click **Run Auto Test**

> "Now watch — Alice's AI Persona takes over. Stagehand browser agent visits the NFT marketplace AS Alice. It executes every checklist item, captures screenshots, and Claude generates a detailed report from Alice's perspective — metrics-driven, performance-focused."

**[Show auto test progress: screenshots, checklist execution, report generation]**

> "Settlement is in 41R tokens: 50% to Alice (passive income!), 50% to treasury. The built-in 5% Transfer Fee funds the platform, and the Transfer Hook atomically records Alice's performance on-chain."

---

## Scene 6: Why Solana? (30s)

**[Show landing page Solana badges]**

> "This isn't crypto bolted on. Five Solana technologies are structural:
> 1. **x402** — per-API-call payments for accessing test results
> 2. **Token-2022 Transfer Fee** — 5% auto-collected on every 41R transfer
> 3. **Transfer Hook** — atomic payment + performance recording
> 4. **SAS Attestation** — persona credentials verified on-chain
> 5. **USDC instant settlement** — testers paid in seconds, not weeks"

> "Companies submit a URL, testers earn crypto, AI Personas earn passive income. All on Solana. That's 41R."

---

## Backup: Pre-recorded Flows

If live demo has issues:

1. **API responses**: `curl http://localhost:4100/api/tests | python3 -m json.tool`
2. **Persona data**: `curl http://localhost:4100/api/personas | python3 -m json.tool`
3. **Tester profile**: `curl http://localhost:4100/api/tester/AliceTester11111111111111111111111111111111111 | python3 -m json.tool`
4. **Demo verification**: `npx tsx scripts/verify-demo.ts`

## Key Numbers to Mention

- 7,500+ lines of TypeScript
- 12 frontend routes
- 7 database tables
- 6 API endpoint groups
- 5 Solana technology integrations
- 20-dimension PersonaVector
- 3 tests = 1 AI Persona
- $3-$5 USDC per manual test
- 5% automated transfer fee
