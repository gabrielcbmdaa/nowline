# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

pnpm only — npm and yarn are not used here.

```bash
pnpm dev                                  # http://localhost:5124 (pinned; --host to reach it from a phone)
pnpm dev:server                           # the node process on 3001 (3000 is another project)
ulimit -n 64000 && nohup mongod --config /opt/homebrew/etc/mongod.conf &   # see below, and the ulimit is not optional
pnpm test                                 # vitest run, the whole suite
pnpm test client/domain/recurrence.test.ts   # one file
pnpm test -t 'name of the test'           # one test by name
pnpm test:watch
pnpm lint                                 # eslint, on its own
pnpm build                                # lint, then both tsc, then vite build
pnpm build:server                         # tsc into dist-server/; production starts that output
```

`pnpm build` is the static gate and runs four things in order, stopping at the first failure: `eslint .`, `tsc --noEmit` for the client, the same for the server, and then `vite build`. The linter is `typescript-eslint` on `strictTypeChecked`, added on 2026-09-10 for the one rule a compiler cannot give — a promise nobody waits for. Four of its rules are argued with in `eslint.config.js`, each with the reason and the hit count written beside it: two are turned off and two are configured rather than silenced. The largest by far is `no-confusing-void-expression` at 58 hits, because `return startClock()` is how this codebase returns a teardown; the one that says most about the design is `require-await` at 24, because every repository method here is `async` although `localStorage` is not, which is the seam described below and not an accident. Run the gate before claiming a change compiles. CI runs `pnpm test` and `pnpm build` on every push to `main`, and a failure there stops the deploy before the server is touched; that is a second gate, not a reason to skip the first.

`vite.config.ts` pins `TZ=Europe/Madrid` for the test process, because the developer's own zone (La Paz) has not changed its clocks since 1932 and daylight-saving tests would pass there by proving nothing. Never override it.

The default test environment is `node`. A test that needs a DOM or `localStorage` — rendering React is one case, reading a storage key another — needs `// @vitest-environment jsdom` as its first line.

**The server tests need MongoDB running on 127.0.0.1:27017.** Bringing up the development environment means `pnpm dev` **and** a `mongod`, not just the first — without one, part of the suite fails on a connection error that reads like a bug in the code. Homebrew's `brew services start mongodb-community` does not work: MongoDB's own tap formula declares its service with a name and no `run`, so the generated launch agent has nothing to execute and launchd refuses it with `Bootstrap failed: 5`. `--fork` is no help either — MongoDB rejects it on macOS. `nohup ... &` is what replaces both: it survives the terminal closing, and it does not survive a reboot, which is deliberate — this machine's owner wants to start the database himself rather than find it already running.

**Raise the open-file limit first, every time.** macOS gives a process 256 open files; MongoDB asks for 64000, warns about it on every startup, and then **dies** the moment it runs out mid-operation — which it did here on 2026-09-08, while a test was creating a collection. The tests drop and recreate collections constantly, so exhausting 256 descriptors is the normal case and not an unlucky one. A `mongod` started without the `ulimit` in front of it is a database that will fail during a test run and read like a bug in the code.

Those tests write to `nowline_test_<hash of the test file's path>` and nowhere else — one database per test file, because vitest runs files in parallel and they would otherwise drop each other's collections mid-run. The helper in `server/testing/mongo.ts` refuses any other database or host, because dropping is what it does. Port 27017 is always this machine; 27018 is always a tunnel to production.

## Architecture

Four layers, dependencies point one way: `ui → state → storage → domain`.

- **`client/domain/`** — pure functions, no React, no DOM: `geometry` (pixels ↔ minutes), `dates` (day keys), `recurrence` (plan + override → what is drawn), `timer` (start/stop/correct), `summary` (totals), `types`.
- **`client/storage/`** — `repository.ts` declares `BlockRepository` and exports the live instance; `localStorageRepository.ts` is the only file in the app allowed to say `localStorage` — the tests say it too, to arrange and assert on what was stored. Every method is `async` although the implementation is synchronous, so a server implementation can replace it without touching a call site. Keys are `nowline.projects.v2`, `nowline.plans.v2`, `nowline.overrides.v2`, plus `nowline.pending.v1` for the ids this device has not uploaded yet, `nowline.sync.v1` (token, cursor and `joined`), and `nowline.discarded.<date>` (the copy kept before taking the cloud; never overwritten — `.2`, `.3` are appended). The `tt.*.v1` keys this app was born with are migrated once and then **left untouched as a safety net** — do not delete them until every device in use has synced at least once. Every row carries `updatedAt`, written only here; deleting marks `deletedAt` instead of removing the row, and the read methods hide what is marked. Corrupt rows are dropped on read rather than thrown.
- **`client/state/store.ts`** — one module-level `state` object plus a listener set, exposed with `useSyncExternalStore`. No router, no state library. Mutating functions write through the repository first, then `setState`. It also holds **which of the three things the app shows** — `entry: 'deciding' | 'signed-out' | 'asking-first-sync' | 'ready'`, with the counts for the middle one in `firstSync` — worked out by `decideEntry()` and **never derived on the fly**: deciding it costs a request, so a component that recomputed it per render would ask the server per render. And it owns the five moments a round happens: on start, two seconds after any change (debounced), when the tab becomes visible, every five minutes, and thirty seconds after a network failure. `syncNow()` joins a late caller to the round already in flight instead of starting a second one.
- **`server/`** — the Node process: Express on 3001, MongoDB, two routes (`POST /api/auth/login`, `POST /api/sync`) plus `GET /api/health`, and **an error handler as the last `app.use`**. Same split as above — pure logic with no database (`passwords`) apart from what talks to Mongo (`db`, `identity`, and the routes). Which of two copies of a row wins is **not** one of those pure functions: it is the filter of the write in `routes/sync.ts`, because deciding it in JavaScript needs a read and a write with a gap between them, and two overlapping uploads both win in that gap. It compiles with its own `tsconfig.server.json`, because the client one loads the DOM library and Vite's types. Relative imports there need a `.js` extension: the project is ESM and that tsconfig uses `NodeNext`. In production it runs compiled from `dist-server/`, on `127.0.0.1:3001`, behind nginx's `location /api/`, with its configuration in a VPS `.env` that is not in the repository.
- **`client/ui/`** — React 19 components, plain CSS in `client/styles.css` with BEM-ish class names. No CSS framework, no calendar library. Note this project does **not** use the `gcm-minimalist-design-system` skill; it imitates Google Calendar. Two of them are not the calendar and share the `.gate` container: `SignInScreen` and `FirstSyncScreen`. **Neither decides anything** — the engine does; they show numbers and hand back an answer. A screen that needs a new sync rule is a sign the rule is missing from `client/storage/sync.ts`.

### The data model, which everything else follows from

A repeating block is **one** `BlockPlan` row however many days it appears on. A day that deviates — moved, resized, tracked, deleted — gets a `BlockOverride` keyed by `(planId, date)`. `domain/recurrence.ts` resolves the pair into a `ResolvedOccurrence`, which is the only shape the calendar draws.

Consequence: editing a repeating block in the editor moves every day; dragging one day writes an override and moves only that day.

Tracked time is **never stored as a duration**. An override holds `actualStart`/`actualEnd`, and every total is computed at read time. Do not add a `durationSeconds` field to "cache" it — correction, midnight-crossing sessions and the summary all depend on the raw timestamps.

## Invariants a change can silently break

- **A day is a `'YYYY-MM-DD'` string, never a `Date`.** `new Date('2026-09-07')` is UTC midnight, a different calendar day in most of the world. Build every day key through `client/domain/dates.ts`; a date-only string must not reach `new Date`. `client/ui/sheets/DatePickerSheet.test.ts` fails if the month grid breaks this.
- **The hour scale lives in one constant.** `PIXELS_PER_HOUR = 64` in `domain/geometry.ts`; no code may hardcode 64, 1536 or a pixels-per-minute figure — go through `minuteToPixel` and `DAY_HEIGHT`. The exception is a test asserting a pixel figure, which has to spell the number out or it pins nothing: `TimeBlockView.test.tsx` does, and says where each one comes from. Same for `SNAP_MINUTES` and `MINUTES_PER_DAY`. Pinch-to-zoom is a planned feature that turns that constant into a variable.
- **Positions and heights are wall-clock, not elapsed.** Use `minutesSinceMidnight` and `wallClockMinutesBetween` from `domain/dates.ts`, so the two daylight-saving days line up. Elapsed-time arithmetic (`(end - start) / 60000`) is wrong for anything drawn.
- **`overflow-anchor: none` on `.calendar__scroll` must stay,** and so must the manual `scrollTop` compensation in `useInfiniteDays.ts`. The strip keeps seven days mounted and compensates when it prepends one; Chromium and Firefox do the same compensation themselves, so with both the strip jumps a whole day. Browsers without scroll anchoring need the manual half. No unit test catches this.
- **One timer at a time.** `startTimerFor`/`stopRunningTimer` are serialised on a promise queue in `state/store.ts`, and a start re-reads overrides from the repository before deciding. The internal `*Unlocked` variants must not take the lock — start calls stop. Two tabs can still race; closing that needs an atomic compare-and-set the repository cannot offer.
- **Block text colour is computed, not chosen.** `ui/textColor.ts` picks black or white per project colour for contrast, and dims a tracked block by blending its **background** toward the page colour. Never use CSS `opacity` for that — it fades the text too and cancels the contrast out.
- **A block may cross midnight, and is drawn once.** One rectangle that overflows its day section, which sets no `overflow`; `.block` carries `z-index: 1` so the next day's grid does not paint over the overhang. What still holds: a block starts inside the day it belongs to, and lasts at most 24 hours — the second is what bounds the overflow to one day. `occurrencesForDay` returns what belongs to a date, never what passes through it.
- Deleting reads the plan's **stored** recurrence, never the unsaved dropdown.
- Errors the app recovers from go through `reportError`/`reportWarning` in `client/reportError.ts` rather than being swallowed.

### The sync invariants, which are the easiest to break and the hardest to notice

Every one of these was a real defect first, found by a review rather than by a tool. They are written here because a wrong change to any of them loses a row quietly.

- **One door, and the bodies inside it call each other directly.** `syncOnce`, `inspectFirstSync` and `settleFirstSync` all read and write the same two things — this device's queue and its cursor — so they go through one serialised queue (`oneAtATime` in `client/storage/sync.ts`). Their unwrapped bodies (`runSyncOnce` and the others) call each other **without** taking the lock, because a resolution runs a round inside itself and asking for a lock it already holds deadlocks. If the suite ever hangs instead of failing, look here first.
- **`touch` is the only place that *invents* an `updatedAt`,** for a row this device changed, and it compares against that row's own previous stamp. Three other places write the field and **none of them may go through `touch`**: `ensureMigrated` invents one for legacy rows, and `applyFromServer` and `replaceAllFromServer` keep the stamp that arrived. Restamping a download with this device's clock is the infinite ping-pong between two devices.
- **`joined` gates everything, and only ever goes from false to true.** Until it is true every round returns `needs-first-sync`, which is what stops a device merging before its owner has chosen. Nothing may write `joined: false` once it is true: signing in again after an expired token is not joining again, and the question it would re-ask has an answer that replaces every row written since.
- **The cursor is the newest stamp actually handed over, never the wall clock,** and the filter is `$gte`. A clock cursor can run ahead of a row another request is still writing, and `$gt` would skip it for good. `$gte` re-sends the row sitting on the boundary: one row per round, and nothing lost.
- **A plan tombstone drops that plan's overrides, on whichever device sees it.** An override carries no tombstone of its own, so `deletePlan` and `applyFromServer` share one private method for the cascade — and it runs **after** the override merge, because a catch-up reply carries the override from before the deletion and the tombstone from after it. Skip it on the receiving side and a running override with no plan to stop it stays behind, invisible and counted.

## Conventions

**The repository is written in English, without exception.** Code, identifiers, file names, comments, test names, commit messages, `README.md` and this file: English, whatever language the work was discussed in. Every tracked file holds to this today — keep it that way. The owner works in Spanish, so talk to him in Spanish and commit in English.
