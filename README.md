# Nowline

A time tracker shaped like a calendar. You plan a block, press play when you actually
start, and press stop when you actually finish — the block moves to the real time and
shrinks to what really happened. The name is the red line that crosses the current hour.

Mobile first, running on the web for now. Local first on this device, with one account
kept in sync on the server.

## Running it

Requires [pnpm](https://pnpm.io). npm and yarn are not used here.

Three processes in development: the Vite dev server, the Node API, and MongoDB for
the API and for the test suite.

```bash
pnpm install
pnpm dev              # http://localhost:5124; add --host to open on a phone
MONGO_URL=mongodb://127.0.0.1:27017 MONGO_DB=nowline_dev PUBLIC_URL=http://localhost:5124 MAIL_TRANSPORT=console pnpm dev:server   # 127.0.0.1:3001
pnpm test             # needs MongoDB on 127.0.0.1:27017
pnpm build            # eslint, both type-checks, then vite build
pnpm preview          # the production build, on the same origin as dev (stop dev first)
```

The server refuses to start without `MONGO_URL`, `MONGO_DB`, `PUBLIC_URL` and
`MAIL_TRANSPORT` — it never defaults the database name or the way email leaves.
`console` prints every email on the terminal, link included; `zavu` needs
`MAIL_API_KEY` and `MAIL_SENDER` as well. `pnpm test` writes only to `nowline_test_*`
databases on 127.0.0.1:27017 and sends nothing. See [CLAUDE.md](CLAUDE.md) for bringing
MongoDB up on this machine, including the open-file limit before `mongod`.

## Deploy

Live at <https://nowline.gabrielcbmd.com>.

Every push to `main` runs two jobs. The first installs dependencies, runs the whole
suite against a `mongo:8` service, builds, and uploads `dist/` as an artifact. Only
if that passes does the second job deploy — and it updates the **server first**, then
copies the static files with `rsync --delete`: the other order leaves a new client
calling `/api/sync` against a server that does not know what that is yet.

On the server, the Node process runs from compiled `dist-server/` on `127.0.0.1:3001`,
behind nginx's `location /api/`; its configuration lives in a `.env` on the machine,
not in this repository: `MONGO_URL`, `MONGO_DB`, `PORT`, `PUBLIC_URL` (the origin every
emailed link points at), `MAIL_TRANSPORT=zavu`, `MAIL_API_KEY` and `MAIL_SENDER` (the
Zavu sender id). Host, user and path live in repository secrets.

The `/api/auth/` routes sit behind an nginx `limit_req` as well — coarse on purpose:
the real rules live in Express, where they are tested, and this stops a flood before it
costs Node and Mongo a round trip. In `/etc/nginx/sites-available/nowline`, above the
`server` block (Ubuntu includes `sites-enabled` inside `http`, so that is the `http`
context; the zone is named for this site because Switchat's vhost shares it):

```nginx
limit_req_zone $binary_remote_addr zone=nowline_auth:1m rate=30r/m;
```

and inside `server`, next to `location /api/` (the longest prefix wins; 503 is nginx's
default, and the client reads 429 as "too many attempts"):

```nginx
location /api/auth/ {
    limit_req zone=nowline_auth burst=10 nodelay;
    limit_req_status 429;
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## How it works

Everything is local first: the calendar reads and writes on this device, and a
round trip to the server only agrees the two copies. One account holds the rows;
a device signs in once, and if both sides already have data it asks once what to
do with the two copies.

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

`client/domain/recurrence.ts` resolves the two into what you see.

### Tracked time is derived, never stored

No record anywhere holds "how long this took". A tracked block stores `actualStart` and
`actualEnd`, and every total is `actualEnd − actualStart` computed at read time.

This is what makes correction work: change the end time and every number in the app
follows, with nothing left to migrate. It is also why the summary can attribute a session
that crosses midnight to both days — it has the real timestamps, not a lump sum.

### The hour scale lives in exactly one constant

`PIXELS_PER_HOUR = 64` in `client/domain/geometry.ts`. Nothing anywhere else may hardcode 64,
or 1536, or a pixels-per-minute figure — everything goes through `minuteToPixel` and
`DAY_HEIGHT`. Pinch-to-zoom on the hour scale is a wanted feature that has not been built;
when it is, that one constant becomes a variable and the whole calendar follows.

The same rule holds for `SNAP_MINUTES = 15` and `MINUTES_PER_DAY`.

### A day is a `'YYYY-MM-DD'` string, and never a `Date`

`new Date('2026-09-07')` parses as **UTC** midnight, which in most of the world is a
different calendar day. Every date in this app is a local day key built through
`client/domain/dates.ts`, and a date-only string must never reach `new Date`. A test in
`client/ui/sheets/DatePickerSheet.test.ts` fails if that rule is broken in the month grid,
which is where it bit hardest.

### The repository stays local; sync sits beside it

`client/storage/repository.ts` defines the `BlockRepository` interface and exports the active
implementation. Nothing outside `client/storage/` touches `localStorage` or knows it
exists, tests aside. Every method is `async` even though the current implementation is
synchronous, so a network-backed store could replace the local one without touching a
single call site — but the server did not replace it. The app stays local first; rounds
of agreement with one account live in `client/storage/sync.ts` beside the repository
(upload what this device owes, download what it lacks). See `CLAUDE.md` for the sync
invariants.

### Damaged storage is quarantined, never overwritten

A damaged key — an empty string, JSON that is not an array, a row without a string `id` —
is reported on every read and what can be read is returned. Before the first write that
would overwrite it, `write` copies the raw text under `<key>.corrupt` (then `.corrupt.2`,
`.3`…, never overwriting an earlier copy), and refuses the overwrite if that copy cannot
be written. That same write raises `nowline.resync.v1`, because the rows this device could
not read will not come back through the cursor — the next round downloads everything. A
phone has no console to dig the data out of.

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
the contrast it just gained. `client/ui/textColor.ts`.

### A block may cross midnight, as one rectangle that overflows its day

A block starts on the day it is placed on and may end on the next, up to a full turn of
the clock. It is drawn **once**, by the day it starts on, at its true minute, and simply
overflows the day section — which sets no `overflow`, so nothing clips it. Blocks carry
`z-index: 1` for exactly this: the next day's section comes later in the document and
would otherwise paint its hour lines and its date label over the overhang.

This is what keeps the calendar a per-day question. `occurrencesForDay` returns what
*belongs* to a date, never what merely passes through it, so a day's answer is complete
on its own — no day depends on its neighbour being mounted to be drawn correctly.

The end field in the editor says **next day** when the block lands there, the same way
the tracked correction already did: an end at or before the start clock is read as the
following day.

Two rules survive, and only these two: a block **starts** inside its day (both drag
handles clamp to it, and the editor rejects anything else), and it lasts at most 24
hours. The second is not decoration — it is what bounds the overflow to one day.

Until 2026-09-05 a planned block was validated to end on the same day, and the rule was
enforced in silence: one at 23:00 stopped growing at exactly one hour with nothing said.
The tracked side was never bound by it — a timer left running overnight has always
produced a block past midnight — and those were drawn in the wrong place, slid up the
grid until they fitted inside the day.

### Deleting reads what is saved, not what is on screen

The delete button decides whether to ask "this day or all days?" from the plan's **stored**
recurrence, never from the unsaved dropdown. Reading the draft meant that switching a daily
block to "does not repeat" and pressing delete destroyed the whole series with no
confirmation at all.

### One timer at a time

Timer transitions are serialised on a promise queue in `client/state/store.ts`, and a start
re-reads the running timer from storage before deciding. Two browser tabs can still race in
the gap between that read and the write — closing it needs an atomic compare-and-set that
`localStorage` cannot offer and the server does not offer yet. See the caveats below.

## Layout

```
client/domain/         pure logic: geometry, dates, the stopwatch, recurrence, totals
client/storage/        the repository interface and its localStorage implementation
client/storage/sync.ts one round: upload what is owed, download what is missing
client/state/          one module-level store, exposed through useSyncExternalStore
client/ui/             React components; client/ui/calendar/ is the strip
server/                Express + MongoDB: POST /api/auth/login, POST /api/sync, GET /api/health
```

No router, no state library, no CSS framework, no calendar library. React 19, TypeScript,
Vite and Vitest.

## Known limitations

- **Two open tabs can both start a timer.** Narrowed, not eliminated; closing it needs an
  atomic compare-and-set that neither `localStorage` nor the server offer today.
- **The calendar strip has no rendering tests.** The ones that render cover a
  block and the two sheets; the strip itself — scrolling, the sliding window, a drag from
  pointer to stored override — was verified by hand in a browser, which is not repeatable
  in CI. This is the most valuable thing left to add.
- **The grid is always 24 hours tall, even on the two days that are not.** Blocks are
  placed by wall-clock minute, a planned end is wall-clock minutes after its start, and
  totals are summed from real timestamps, so all three are right on a clock change —
  `client/domain/dates.ts`, with the tests pinned to Madrid because it changes its clocks.
  The hour no clock shows on the day they go forward moves a block forward by the jump
  (02:30 becomes 03:30 in Madrid), which is the RFC 5545 reading and is pinned for every
  minute of the year. What does not happen is the grid growing or shrinking: the skipped
  hour still takes up its 64 pixels.
- **Block times show no AM/PM** — `7:00` reads the same at either end of the day. The hour
  gutter beside the block supplies the context. Deliberate, matching the design.
- **The date picker has no arrow-key navigation.** Tab and Enter work.
- **Desktop wheel scrolling is not suppressed during a mouse drag.**
- Per-row rounding means two rows of 29 seconds each show `0h 0m` while the footer shows
  `0h 1m`. Inherent to rounding to the minute.

## License

MIT — see [LICENSE](LICENSE).
