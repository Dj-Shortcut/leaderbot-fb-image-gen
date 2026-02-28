# Repository Health Snapshot

## 1) Repo Health Snapshot (very light)

### CI status overview
- One CI workflow (`.github/workflows/ci.yml`) runs on PRs and pushes to `main`.
- Current gate set: install deps, lint (`pnpm run lint`), and build (`pnpm run build`).
- Missing in CI today: explicit server lint, typecheck, and tests.

### Lint/Typecheck setup summary
- TypeScript is in `strict` mode (`"strict": true`) with `tsc --noEmit` available via `pnpm run check`.
- ESLint uses `typescript-eslint` type-aware config (`recommendedTypeChecked`) and enforces `no-floating-promises`.
- Script split is slightly fragmented: `lint` covers `client/src shared`, while server lint is separate (`lint:server`).

### Branch structure overview
- Local branch structure appears minimal (`work` checked out).
- CI policy suggests `main` is intended as integration branch (push-triggered workflow).
- No evidence in-repo of release/hotfix branch conventions.

### 5 low-effort, non-breaking improvements
1. Add `pnpm run check` to CI for explicit strict type gating.
2. Add `pnpm run test` to CI to lock in behavior regressions.
3. Replace `lint` with a combined script that also includes server lint.
4. Add CI `concurrency` cancellation for superseded runs.
5. Add a short `CONTRIBUTING.md` with branch + PR conventions.

---

## 2) CI Harden Mini-Audit (`.github/workflows/ci.yml`)
1. **Pin install behavior tighter:** use `pnpm install --frozen-lockfile --prefer-offline` to reduce transient registry hiccups.
2. **Add workflow/job timeout:** e.g. `timeout-minutes: 15` to avoid hung runners.
3. **Add concurrency cancellation:**
   ```yml
   concurrency:
     group: ci-${{ github.ref }}
     cancel-in-progress: true
   ```
   Improves reliability under rapid push bursts without meaningful runtime cost.

---

## 3) Strict Mode Risk Scan (runtime risks still possible)
1. **Unchecked external JSON casts:** image API response is cast directly and nested fields are assumed present (`result.image.b64Json`).
2. **Environment fallback-to-empty strings:** required secrets are typed as strings but default to `""`, so runtime failures shift later.
3. **In-memory state/job stores:** process memory maps/arrays have no backpressure, persistence, or multi-instance consistency.

---

## 4) DX Micro-Improvements (no runtime behavior change)
1. Add `lint:all` script (`lint` + `lint:server`) and use that in CI.
2. Add `test:watch` script for local feedback loops.
3. Add `check:all` script chaining lint, typecheck, test.
4. Add `docs/architecture.md` with module map of `server/_core`.
5. Standardize log prefixes (`[webhook]`, `[image]`, `[oauth]`) for grep-friendly debugging.

---

## 5) “What would break first?” (under production load)
1. **In-memory conversation state** (`Map`) can grow and diverge across instances; horizontal scaling breaks user continuity first.
2. **In-memory job list** (`jobs[]`) is unbounded; sustained throughput risks memory pressure.
3. **Synchronous dependency chain on external fetches** (image generation + storage) has no retry/circuit-breaker strategy, so transient provider issues cascade quickly.
