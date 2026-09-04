# Nowline

A time tracker shaped like a calendar. You plan a block, press play when you actually
start, and press stop when you actually finish — the block moves to the real time and
shrinks to what really happened. The name is the red line that crosses the current hour.

Mobile first, running on the web for now. Everything is stored in the browser.

## Running it

Requires [pnpm](https://pnpm.io). npm and yarn are not used here.

```bash
pnpm install
pnpm dev          # http://localhost:5173, or --host to open it on a phone
pnpm test         # 93 unit tests
pnpm build        # type-check, then a production build
```

## How it works

Three tabs: **Calendar**, **Summary**, **Projects**.

A **project** is nothing but a coloured label. A **block** is a plan: a title, a time, a
duration and a repeat rule. Pressing **play** on today's block starts a timer; the block
jumps to the current time keeping its length. Pressing **stop** shrinks it to the seconds
actually elapsed. If you forget to stop, a banner appears after 12 hours and offers to
fix it.

## Decisions you cannot read off the code

Everything below is a deliberate choice. Each one is cheap to undo and expensive to
rediscover.

### One row per intention, one note per day that differs

A block repeating every day is a single `BlockPlan` row, no matter how many days it
appears on. A day that deviates — you moved it, you tracked it, you deleted just that one
— gets a `BlockOverride` keyed by `(planId, date)`.

Think of a timetable stuck on the fridge with handwritten notes on top of it. Editing the
timetable changes every day; a note changes one. This is why changing a repeating block's
time in the editor moves all its days at once, while dragging one day moves only that day.

`src/domain/recurrence.ts` resolves the two into what you see.

### Tracked time is derived, never stored

No record anywhere holds "how long this took". A tracked block stores `actualStart` and
`actualEnd`, and every total is `actualEnd − actualStart` computed at read time.

This is what makes correction work: change the end time and every number in the app
follows, with nothing left to migrate. It is also why the summary can attribute a session
that crosses midnight to both days — it has the real timestamps, not a lump sum.

### The hour scale lives in exactly one constant

`PIXELS_PER_HOUR = 64` in `src/domain/geometry.ts`. Nothing anywhere else may hardcode 64,
or 1536, or a pixels-per-minute figure — everything goes through `minuteToPixel` and
`DAY_HEIGHT`. Pinch-to-zoom on the hour scale is a wanted feature that has not been built;
when it is, that one constant becomes a variable and the whole calendar follows.

The same rule holds for `SNAP_MINUTES = 15` and `MINUTES_PER_DAY`.

### A day is a `'YYYY-MM-DD'` string, and never a `Date`

`new Date('2026-09-07')` parses as **UTC** midnight, which in most of the world is a
different calendar day. Every date in this app is a local day key built through
`src/domain/dates.ts`, and a date-only string must never reach `new Date`. A test in
`src/ui/sheets/DatePickerSheet.test.ts` fails if that rule is broken in the month grid,
which is where it bit hardest.

### One file to swap for a server

`src/storage/repository.ts` defines the `BlockRepository` interface and exports the active
implementation. Nothing outside `src/storage/` touches `localStorage` or knows it exists.
Every method is `async` even though the current implementation is synchronous, precisely
so that a network implementation can replace it without touching a single call site.

### Native scroll anchoring has to be turned off

The calendar is one continuous strip: seven days stay mounted and the window slides as you
scroll, with `scrollTop` compensated in the same frame a day is prepended. Chromium and
Firefox already do that compensation themselves — it is called scroll anchoring — so with
both running, every prepended day moved the strip **twice** and it jumped a full day.

`overflow-anchor: none` on `.calendar__scroll` disables the browser's version. The manual
compensation must stay, because browsers without scroll anchoring never do it. Removing
either half breaks the strip, and no unit test can catch it.

### Block text picks its own colour

White text clears the accessibility contrast floor on exactly one of the eight project
colours. Each block chooses black or white against its own background, so all eight are
readable — yellow goes from 1.80 to 11.65.

A tracked block is dimmed by blending its **background** toward the page colour, not with
CSS `opacity`, because `opacity` fades the text along with the background and cancels out
the contrast it just gained. `src/ui/textColor.ts`.

### A planned block cannot cross midnight; a tracked one can

Planned times are validated to start and end on the same day. Real ones are not: a timer
left running overnight is normal, and the correction dialog shows the end marked
**next day** rather than pretending it did not happen.

### Deleting reads what is saved, not what is on screen

The delete button decides whether to ask "this day or all days?" from the plan's **stored**
recurrence, never from the unsaved dropdown. Reading the draft meant that switching a daily
block to "does not repeat" and pressing delete destroyed the whole series with no
confirmation at all.

### One timer at a time

Timer transitions are serialised on a promise queue in `src/state/store.ts`, and a start
re-reads the running timer from storage before deciding. Two browser tabs can still race in
the gap between that read and the write — closing it needs an atomic compare-and-set that
`localStorage` cannot offer and a server can. See the caveats below.

## Layout

```
src/domain/     pure logic: geometry, dates, the stopwatch, recurrence, totals
src/storage/    the repository interface and its localStorage implementation
src/state/      one module-level store, exposed through useSyncExternalStore
src/ui/         React components; src/ui/calendar/ is the strip
```

No router, no state library, no CSS framework, no calendar library. React 19, TypeScript,
Vite and Vitest.

## Known limitations

- **Two open tabs can both start a timer.** Narrowed, not eliminated; needs the server.
- **No component rendering tests.** All 93 tests cover pure logic and storage. The UI
  behaviour was verified by hand in a browser, which is not repeatable in CI. This is the
  most valuable thing left to add.
- **Daylight saving is out of scope.** Several paths assume 1440-minute days.
- **Block times show no AM/PM** — `7:00` reads the same at either end of the day. The hour
  gutter beside the block supplies the context. Deliberate, matching the design.
- **The date picker has no arrow-key navigation.** Tab and Enter work.
- **Desktop wheel scrolling is not suppressed during a mouse drag.**
- Per-row rounding means two rows of 29 seconds each show `0h 0m` while the footer shows
  `0h 1m`. Inherent to rounding to the minute.
