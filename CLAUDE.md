# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository. Keep responses grounded in the rules below; if a change would violate one of them, stop and confirm before proceeding.

For deep operational expertise (debugging, adding providers, full architecture walkthroughs), invoke the `/aiclient-master` skill — it loads on-demand references in `~/.claude/skills/aiclient-master/references/` covering architecture, debugging, and the add-provider checklist.

---

## What This Project Is

AIClient2API is a Node.js proxy on `http://localhost:3000` that unifies client-only model surfaces (Gemini CLI OAuth, Google Antigravity OAuth, AWS Kiro OAuth, OpenAI Codex OAuth, Grok web, OpenAI-compatible relays like OpenRouter / NVIDIA NIM / GitHub Models, plus direct Claude/Anthropic) behind one OpenAI/Anthropic/Gemini-compatible API. Clients like Claude Code, Cline, Aider, and Cherry Studio talk to it as if it were a normal model API.

Entry point: `src/core/master.js`. HTTP layer: `src/services/api-server.js` and `src/services/api-manager.js`.

---

## Non-Negotiable Rules

These have all bitten previous sessions. Violations break the user's daily workflow.

1. **Proxy port is 3000.** Never change `SERVER_PORT` in `configs/config.json`. Many clients are hard-coded to `http://localhost:3000`.
2. **`listModels()` is static.** The authoritative model catalog is `STATIC_PROVIDER_MODELS` at `src/providers/provider-models.js:24`. Do not make `listModels` async or have it hit a live upstream — this is a hot-path constraint and also creates a TDZ via the `adapter.js → gemini-core.js → provider-models.js` circular import.
3. **Model-list getters stay synchronous.** Adding `await` to startup model enumeration breaks the same import chain.
4. **No `needsReauth: true` on static-key providers.** The set is defined at `src/providers/provider-pool-manager.js:49`: `openai-custom`, `openaiResponses-custom`, `forward-api`, `grok-web`, `nvidia-nim`, `github-models`. They have no refresh flow; flagging them for reauth makes the pool spin on a nonexistent `refreshToken()`.
5. **`configs/provider_pools.json` holds live OAuth tokens and bearers.** Never `git add -A`. Always review diffs before committing — the user has been burned by accidental token leaks.
6. **Restart after `src/` changes.** There is no working watcher; trust only a fresh `npm start`.

---

## Commands

```bash
# Run
npm start                 # production
npm run start:standalone  # API only, no web UI
npm run start:dev         # dev mode with extra logging

# Discovery
npm run help              # add `-- --json` for structured output
npm run example:api       # API call examples

# Tests
npm test
npm run test:unit
npm run test:integration
npm run test:coverage
```

### Operational diagnostics

```bash
# Is the proxy alive?
lsof -nP -i :3000 -t
curl -s http://127.0.0.1:3000/api/help -o /dev/null -w "%{http_code}\n"

# Per-account pool health (no auth needed)
curl -s http://127.0.0.1:3000/provider_health | python3 -m json.tool | head -60

# Live model list, broken down by provider
curl -s http://127.0.0.1:3000/v1/models \
  -H "Authorization: Bearer $(python3 -c "import json;print(json.load(open('configs/config.json'))['REQUIRED_API_KEY'])")" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); by={}; \
    [by.setdefault(m['id'].split(':')[0] if ':' in m['id'] else m.get('owned_by','?'),[]).append(m['id']) for m in d['data']]; \
    print('total:', len(d['data'])); [print(f'  {k}: {len(v)}') for k,v in sorted(by.items())]"

# Background restart with readiness wait
kill $(lsof -t -i:3000) 2>/dev/null; sleep 1
npm start > /tmp/aiclient.log 2>&1 &
for i in $(seq 1 30); do curl -sf http://127.0.0.1:3000/api/help -o /dev/null && break; sleep 1; done
```

---

## Architecture (where each concept lives)

| Concept | File | Why it matters |
|---|---|---|
| Adapter registry | `src/providers/adapter.js:23` (`registerAdapter`), `:756` (`getServiceAdapter`), `:704-716` (registrations) | If a provider isn't registered here, its `x-model-provider` header is rejected and its models are invisible |
| Static model catalog | `src/providers/provider-models.js:24` (`STATIC_PROVIDER_MODELS`) | Authoritative model list per provider; what `/v1/models` exposes |
| Provider mapping (rotation) | `src/utils/provider-utils.js:14` (`PROVIDER_MAPPINGS`) | Maps credential file patterns to provider types; required for UI and usage tracking |
| Static-key set | `src/providers/provider-pool-manager.js:49` (`STATIC_KEY_PROVIDERS`) | Bearer-only providers without OAuth refresh — see Rule 4 |
| Pool selection | `src/providers/provider-pool-manager.js` (`selectProvider`, `_enqueueRefresh:263`, `getAllAvailableModels:1473`, `markModelCooldown`) | Rotation, health, refresh queue, model aggregation; `markModelCooldown` applies per-model 429 cooldown without marking whole account unhealthy |
| Cascade parsing | `src/core/config-manager.js:12` (`normalizeConfiguredProviders`) | Splits comma-separated `MODEL_PROVIDER` into `DEFAULT_MODEL_PROVIDERS[]` and picks `[0]` as the default |
| Request dispatch | `src/services/api-manager.js:32` (`handleAPIRequests`) | Maps HTTP path → endpoint type → handler |
| Provider resolution | `src/services/service-manager.js:376` (`_resolveEffectiveRouting`), `:408` (`getApiService`) | Handles `provider:model` prefix routing, AUTO mode, pool selection |
| Model-list aggregation | `src/utils/common.js:1147` (`handleModelListRequest`), `:1214-1218` (aggregation trigger) | Aggregates across all providers when AUTO **or** cascade length > 1; otherwise single-provider |
| Protocol conversion | `src/converters/strategies/*.js` (`OpenAIConverter`, `ClaudeConverter`, `GeminiConverter`, etc.) | Translates request/response shapes between OpenAI / Anthropic / Gemini |
| Convert dispatcher | `src/convert/convert.js` | Picks the right strategy via `ConverterFactory`. `convert-old.js` is legacy — do not edit |
| Provider implementations | `src/providers/{claude,gemini,openai,grok,forward}/*-core.js` | One `*-core.js` per backend, exposing `generateContent`, `generateContentStream`, `listModels` |
| TLS sidecar | `src/utils/tls-sidecar.js`, env `TLS_SIDECAR_ENABLED=true` | uTLS fingerprint bypass for Cloudflare-fronted upstreams (Grok web) |
| Logger | `src/utils/logger.js`, output `logs/app.log`, prompt logs `logs/<PROMPT_LOG_BASE_NAME>_*.log` when `PROMPT_LOG_MODE=file` | First place to look after a failure |

---

## Configuration

- `configs/config.json` — server config: port, `MODEL_PROVIDER` cascade, paths, key.
- `configs/config.json` field `REQUIRED_API_KEY` — static API key for `/v1/*` Bearer auth (e.g. `sk-...`). This is what clients use.
- `configs/pwd` — **PBKDF2-hashed admin password** for `POST /api/login`. Not a usable Bearer for `/v1/*`. Don't confuse with `REQUIRED_API_KEY`.
- `configs/provider_pools.json` — per-account credentials and pool metadata. **Contains live tokens** — see Rule 5.
- `configs/custom_models.json` — user-defined model aliases with metadata (`contextLength`, `maxTokens`, `description`).
- `configs/{gemini,antigravity,kiro,codex}/` — OAuth credentials, one JSON per account.

### `MODEL_PROVIDER` cascade vs `auto`

The value can be:

- **Single provider**: e.g. `"gemini-cli-oauth"`. Only that provider's models appear in `/v1/models`.
- **Cascade (comma-separated)**: e.g. `"gemini-cli-oauth,gemini-antigravity,claude-kiro-oauth,..."`. Parsed by `normalizeConfiguredProviders()` into `DEFAULT_MODEL_PROVIDERS[]`; `MODEL_PROVIDER` becomes the first entry. `/v1/models` aggregates across **all** entries (fix landed in commit `083a7cf`, src/utils/common.js:1214-1218). Cross-type fallback at request time is controlled by `providerFallbackChain` in `config.json`.
- **`"auto"`**: forces clients to specify a `provider:model` prefix on every request; `/v1/models` aggregates across all registered providers.

If `/v1/models` returns models for only the first provider in a comma-separated list, the aggregation condition has regressed — check `src/utils/common.js:1214` is checking `DEFAULT_MODEL_PROVIDERS.length > 1` in addition to `MODEL_PROVIDER === 'auto'`.

---

## Authentication

- `/v1/*`, `/v1beta/*`, `/count_tokens` → use the **static API key** from `REQUIRED_API_KEY` in `configs/config.json` (`sk-...`) as `Authorization: Bearer <key>`.
- `/api/*`, `/health`, `/provider_health` → except public endpoints (`/api/help`, `/api/example`, `/provider_health`, `POST /api/login`), need a **dynamic admin token**: `POST /api/login` with the cleartext admin password (the original of what `configs/pwd` hashes to), then use the returned token.
- Common confusion: `configs/pwd` is the **hashed** admin password (PBKDF2), not a usable Bearer. Using its raw contents as a `/v1/*` Bearer fails with 401.

---

## Known Issues (already fixed — recognize regressions, don't re-fix)

| ID | Symptom | File | Fix commit |
|---|---|---|---|
| A | `OpenAIConverter` dropped streamed `tool_calls`; `finish_reason: tool_calls` not mapped to `stop_reason: tool_use` | `src/converters/strategies/OpenAIConverter.js` | `58eb7e4` |
| B | NVIDIA NIM and GitHub Models adapters not registered, `x-model-provider` header rejected | `src/providers/adapter.js:712-713` | `a672392` |
| C | Gemini-only `cleanJsonSchemaProperties` applied to OpenAI-bound tool schemas, stripping fields like `exclusiveMinimum` | `src/converters/strategies/ClaudeConverter.js` | `9537798` |
| D | Antigravity `geminiToAntigravity()` deleted `tools`/`toolConfig` for `isClaudeModel` after VALIDATED-mode setup | `src/providers/gemini/antigravity-core.js` (old line 275-283, removed) | `083a7cf` |
| G | `/v1/models` only aggregated when `MODEL_PROVIDER === 'auto'`; cascade configs returned only the first provider's models | `src/utils/common.js:1214-1218` | `083a7cf` |

E (Antigravity "hang") and F (Kiro 400) were investigated and found to be cold-call OAuth bootstrap and already-fixed respectively.

---

## Gotchas

- **Antigravity first call takes 30-50s.** Not a hang — it's the OAuth token refresh + Project ID discovery on first use of each credential. Warm calls land in ~1s. Reproduce twice before patching `streamApi` / `parseSSEStream`.
- **Detached HEAD is the working state.** This branch is detached from tag `v3.0.5.3`. Recent commits live only locally until pushed to a branch.
- **`convert-old.js` is legacy.** Edit `src/converters/strategies/` and `src/convert/convert.js`, never `convert-old.js`.
- **`PROMPT_LOG_MODE: "file"`** is the single highest-information debug tool. Flip it on in `configs/config.json`, restart, reproduce, then read `logs/<PROMPT_LOG_BASE_NAME>_*.log` to see the exact payload sent upstream.
- **Health check defaults differ.** `defaultCheckModel` per provider is in `PROVIDER_MAPPINGS` (e.g. Antigravity uses `gemini-2.5-computer-use-preview-10-2025`); changing it changes which model the periodic health check exercises.
- **OAuth providers must not appear in `STATIC_KEY_PROVIDERS`.** Adding them disables refresh and silently breaks every account after token expiry.
- **`SCHEDULED_HEALTH_CHECK` is now enabled** for `gemini-cli-oauth`, `gemini-antigravity`, `claude-kiro-oauth`, `openai-codex-oauth`. After startup, Antigravity accounts whose GCP projects don't have the Staging CloudCode API enabled will appear unhealthy with HTTP 403 "API has not been used in project X before or it is disabled." This is a pre-existing account configuration issue — not a proxy bug. Remaining healthy accounts serve normally. Fix: visit the `console.developers.google.com` URL in the error and enable the API for that project.

---

## Verification Before Claiming Done

After any change touching routing, model configuration, or auth:

1. Restart the proxy (`kill $(lsof -t -i:3000); npm start ...`).
2. `curl /provider_health` — confirm count and check for unexpected unhealthy entries. Some Antigravity accounts may show unhealthy at startup if their GCP projects lack the Staging API — this is expected after enabling `SCHEDULED_HEALTH_CHECK` (see Gotchas). Focus on whether the providers you rely on are healthy.
3. `curl /v1/models` — confirm model count matches expectations (the per-provider breakdown is the most useful signal).
4. The specific scenario you changed — tool-use curl, streaming response, etc. State exact numbers ("70 models, 0 unhealthy items, tool_use response in 1.1s"), not assertions ("should work now").

For tool-use scenarios across providers, see the curl matrix in `~/.claude/skills/aiclient-master/references/debugging.md`.

---

## Where to Get More Detail

- `/aiclient-master` skill — invoke it for any non-trivial work on this proxy. It loads project-specific architecture, debugging, and add-provider references on demand.
- `Materials/` (if present locally) — authoritative reference configs and credential file shapes. Not in git.
- `logs/app.log` — runtime logs. `tail -f` while reproducing.
- Memory (`~/.claude/projects/-Users-ilialiston-AIClient2API/memory/MEMORY.md`) — user-specific cross-session context (proxy state, cascade chain, hard constraints).
