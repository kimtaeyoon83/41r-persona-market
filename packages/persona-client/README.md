# @41rpm/persona-client

TypeScript client for [persona-engine](../../apps/persona-engine/).

## Install

Workspace-local (used by `apps/api`):

```json
// apps/api/package.json
{
  "dependencies": {
    "@41rpm/persona-client": "workspace:*"
  }
}
```

## Usage

```ts
import { PersonaEngineClient } from '@41rpm/persona-client';

const engine = new PersonaEngineClient({
  baseUrl: process.env.PERSONA_ENGINE_URL ?? 'http://persona-engine:4200',
});

// 1) Health check on boot
const h = await engine.health();
console.log(h.persona_agent_version);

// 2) Register a persona (from 41rpm TesterProfile)
await engine.createPersona({
  persona_id: 'tester_0xabc',
  profile: {
    age_range: '20s',
    region: 'KR',
    occupation: 'developer',
    expertise: ['defi', 'web3'],
    experience_level: 'expert',
    crypto_experience: 'advanced',
    device_types: ['desktop'],
    primary_device: 'desktop',
  },
});

// 3) Run a browser-mode analysis
const { job_id } = await engine.submitAnalysis({
  persona_id: 'tester_0xabc',
  url: 'https://some.dapp/',
  task: '지갑 연결 후 스왑 1회 시도',
  mode: 'browser',
});

// 4) Wait + fetch result
const result = await engine.waitForResult(job_id, { pollIntervalMs: 3000 });
console.log(result.outcome, result.total_turns, result.new_observations);
```

## Error handling

All non-2xx responses throw `PersonaEngineError` with `.status` and `.body`.
