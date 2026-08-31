# Fork Baseline

**Ticket:** HP-001
**Recorded:** 2026-08-31

This document pins the exact upstream state this fork started from, so that
behaviour changes can always be attributed to our work rather than to upstream drift.

---

## 1. Repositories

| Remote | URL | Purpose |
|---|---|---|
| `origin` | `git@privatno:wildduck80/home-plan.git` | Our fork — all development happens here |
| `upstream` | `https://github.com/laanlabs/openPlan3D.git` | Original project — read-only reference |

`origin` is reached over SSH through the `privatno` host alias defined in `~/.ssh/config`,
which selects the `~/.ssh/wildduck80` identity.

Recreate the remotes on a fresh clone with:

```bash
git clone git@privatno:wildduck80/home-plan.git
cd home-plan
git remote add upstream https://github.com/laanlabs/openPlan3D.git
```

---

## 2. Pinned baseline

| Property | Value |
|---|---|
| Baseline commit SHA | `abb5267581d4ca8d4df00f23c94fb55954de9d40` |
| Baseline commit date | 2026-07-25 |
| Baseline commit subject | `chore: verify App Hosting auto-deploy after repo rename` |
| Baseline branch | `main` |
| `package.json` name | `open3dfloorplan` |
| `package.json` version | `0.9.0` |
| License | MIT (`LICENSE`, retained unmodified) |

Every claim in `docs/current-capability-matrix.md` and every golden fixture in
`tests/fixtures/` is expressed relative to this SHA.

Compare our fork against the pinned baseline at any time with:

```bash
git diff abb5267581d4ca8d4df00f23c94fb55954de9d40...HEAD
```

---

## 3. Attribution

This fork retains the upstream MIT license. `LICENSE` and the upstream author
attribution in `package.json` must not be removed or rewritten.

Upstream project: [laanlabs/openPlan3D](https://github.com/laanlabs/openPlan3D)
Upstream author: theLodgeStudio

---

## 4. Verified base stack

Read from `package.json` at the baseline SHA:

| Dependency | Version range |
|---|---|
| `@sveltejs/kit` | `^2.50.2` |
| `svelte` | `^5.49.2` |
| `typescript` | `^5.9.3` |
| `three` | `^0.182.0` |
| `tailwindcss` | `^4.1.18` |
| `vite` | `^7.3.1` |
| `firebase` | `^12.9.0` (optional at runtime) |
| `jspdf` | `^4.1.0` |
| `dxf-writer` | `^1.18.4` |
| `jszip` | `^3.10.1` |

The baseline had **no test runner, no CI workflow and no `docs/` directory**.
Those are added by HP-002 and later tickets, not inherited from upstream.

---

## 5. Local setup

Requires Node 20 or newer.

```bash
npm install
npm run check    # svelte-kit sync + svelte-check
npm run build    # production build
npm run dev      # dev server on http://localhost:5173
npm test         # unit tests (added in HP-002)
```

### Baseline verification results

Run against the pinned SHA on 2026-08-31 (darwin, arm64):

| Command | Result |
|---|---|
| `npm install` | pass |
| `npm run check` | **6 errors, 25 warnings in 9 files** — pre-existing, see below |
| `npm run build` | pass (`built in 5.45s`, `@sveltejs/adapter-node`) |

#### Pre-existing `npm run check` errors (baseline, not regressions)

All 6 errors share one root cause: the `Tool` union in `src/lib/stores/project.ts`
omits the `'measure'` and `'annotate'` tools that `BuildPanel.svelte` actually
dispatches, so those comparisons and assignments fail to type-check.

```text
src/lib/components/sidebar/BuildPanel.svelte
  433:99, 434:34, 436:88   'Tool' vs '"annotate"' — no overlap / not assignable
  445:99, 446:34, 448:88   'Tool' vs '"measure"'  — no overlap / not assignable
```

Files carrying baseline warnings: `CommandPalette.svelte`, `ContextMenu.svelte`,
`FloorPlanCanvas.svelte`, `PrintLayout.svelte`, `BuildPanel.svelte`, `TopBar.svelte`,
`MaterialPicker.svelte`, `ThreeViewer.svelte`, `routes/+page.svelte`.

These counts are the regression threshold: CI (HP-002) must not let the error count
grow above the baseline. See `docs/current-capability-matrix.md` for behavioural findings.

---

## 6. Upstream sync policy

Per the implementation plan (EPIC 0), before starting a major epic:

```bash
git fetch upstream
git log --oneline HEAD..upstream/main        # review what changed
git switch -c integration/upstream-YYYY-MM-DD
git merge upstream/main
npm run check && npm run build && npm test
# merge into main only when green
```

Fork-specific changes that are likely to conflict with upstream are tracked in
`docs/upstream-sync.md`.
