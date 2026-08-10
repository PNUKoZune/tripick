---
name: run-tripick
description: Build, launch, and drive the TriPick web app (Next.js WebView + NestJS API) to see a change working or screenshot a screen. Use when asked to run, start, launch, or screenshot TriPick, the planner, the web app, or any authenticated screen (trips, inbox, preferences, settings). Handles the login+seed setup that gates every screen and drives it headlessly with Playwright.
---

# Run TriPick

TriPick is a pnpm/Turborepo monorepo: **NestJS API** (`apps/api`, port 4000) +
**Next.js web app** (`apps/web`, port 3000, proxies `/api/v1` → 4000) backed by
Postgres/pgvector, Redis, MinIO (Docker). Almost every screen is behind
`SessionGuard` and loads data from the API, so a plain GET shows nothing — you
must log in and have real trip data. The driver
[`.claude/skills/run-tripick/driver.mjs`](driver.mjs) automates that: demo-login →
inject session into `localStorage` → open a page headless → screenshot.

**All paths below are relative to the repo root.** Run everything from there
unless noted.

## Prerequisites

- Node (repo uses v24), pnpm, Docker + docker compose — already present here.
- **Headless Chromium system libs.** Playwright's Chromium needs `libnspr4`
  and friends. Install once (needs a **real terminal** — `sudo` cannot prompt
  for a password inside Claude Code's `!` runner, you get
  `sudo: a terminal is required to authenticate`):

  ```
  sudo apt-get update && sudo $(which npx) playwright install-deps chromium
  ```

  Minimal fallback if `install-deps` is unavailable:
  `sudo apt-get install -y libnspr4 libnss3 libasound2t64`
  (drop the `t64` suffix on older Ubuntu).

## Setup (once)

Install the driver's Playwright + download the Chromium build (browser is cached
in `~/.cache/ms-playwright`, so this is fast after the first time):

```
cd .claude/skills/run-tripick && npm install && npx playwright install chromium && cd -
```

## Build / launch the stack

```
docker compose up -d                                  # postgres, redis, minio, mailpit
pnpm --filter @tripick/api dev > /tmp/tripick-api.log 2>&1 &
pnpm --filter @tripick/web dev > /tmp/tripick-web.log 2>&1 &
```

Wait until both answer (API creates its schema on boot via `synchronize` in dev).
There is **no `/health` route on this branch** (it lives only in the deploy-prep
branch), so poll for the TCP connection succeeding — `curl -s` exits 0 on any
HTTP response (a 404 still means the server is up):

```
until curl -s -o /dev/null http://127.0.0.1:4000/api/v1; do sleep 1; done
until curl -s -o /dev/null http://localhost:3000; do sleep 1; done
echo "up"
```

## Driver account setup (once per database)

There is no anonymous session endpoint — `/auth/demo` was removed because it
logged every visitor into one shared account. The driver logs in with a real
account, so create it once. Sign up through the API, then mark it verified in
the DB directly: the verification link's raw token only exists in the mail
(console log), while the DB stores just a hash.

```
curl -sX POST http://127.0.0.1:4000/api/v1/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"driver@tripick.test","password":"driver1234","nickname":"드라이버"}'

docker compose exec -T postgres psql -U tripick -d tripick -c \
  'UPDATE users SET "emailVerifiedAt"=now(), "passwordHash"="pendingPasswordHash", "pendingPasswordHash"=NULL WHERE email=$$driver@tripick.test$$;'
```

Override with `DRIVER_EMAIL` / `DRIVER_PASSWORD` if you use a different account.

## Seed a demo trip

`seed:demo-live` attaches the trip to the account named by `SEED_USER_EMAIL`.
Capture the printed trip id into `TRIP_ID`:

```
TRIP_ID=$(SEED_USER_EMAIL=driver@tripick.test pnpm --filter @tripick/api seed:demo-live 2>/dev/null \
  | grep -oP 'trip:.*\(\K[0-9a-f-]{36}')
echo "TRIP_ID=$TRIP_ID"
```

## Run (agent path) — the driver

Smoke test the planner replan banner (the alert→replan deep-link feature) and
drop screenshots in `.claude/skills/run-tripick/shots/`:

```
cd .claude/skills/run-tripick
TRIP_ID=$TRIP_ID node driver.mjs
```

Prints a checks object (all `true` = pass) and writes `banner-weather.png`,
`banner-crowd.png`, `banner-deviation.png`, `banner-dismissed.png`,
`banner-to-modal.png`. It verifies: each trigger's banner renders, **닫기 removes
the banner without opening the modal** (no replan job), and **AI 재계획 opens the
ReplanModal**.

Screenshot any other authenticated screen (only login needed, no `TRIP_ID`):

```
cd .claude/skills/run-tripick
node driver.mjs "/trips" trips.png
node driver.mjs "/planner?tripId=$TRIP_ID&day=1&replan=weather" planner.png
```

**Always look at the resulting PNG** in `shots/` — a blank/error frame means the
session didn't take or the server isn't up.

Env knobs: `WEB_BASE` (default `http://localhost:3000`), `API_BASE`
(`http://127.0.0.1:4000`), `TRIP_ID`, `DRIVER_EMAIL`, `DRIVER_PASSWORD`,
`VIEWPORT` (`430x880`).

## Run (human path)

`pnpm --filter @tripick/web dev` then open `http://localhost:3000` in a browser
and log in. Useless headless — there's no window to see — which is why the driver
exists.

## Test

```
pnpm --filter @tripick/api exec jest <pattern>   # e.g. inbox, arrival-alert
pnpm --filter @tripick/api typecheck
pnpm --filter @tripick/web typecheck
```

## Gotchas

- **Every UI screen needs a session.** No `localStorage['tripick.session.v1']` →
  `SessionGuard` redirects to login and you screenshot a login page. The driver
  handles this; if you drive by hand, inject that key (value = the
  `/auth/login` response JSON `{tokens,user}`).
- **`sudo` fails under the `!` runner** (`a terminal is required to
  authenticate`). System-lib installs must be done in a real terminal — see
  Prerequisites.
- **A freshly created driver account has no preferences**, so the "취향부터
  설정해 볼까요?" bottom sheet covers the first screen you shoot (it looks like a
  broken page). Dismiss it in the driver (`나중에 하기`) or save preferences once
  at `/preferences` for that account.
- **Seed and driver must point at the same account.** `SEED_USER_EMAIL` (seed)
  and `DRIVER_EMAIL` (driver) both default to `driver@tripick.test`; if you
  change one, change the other or the driver logs into an account with no trip.
- **Seed before smoke.** `seed:demo-live` throws if that account does not exist
  yet — run the account setup above first. Re-running seed deletes and
  recreates its own `성수·한강 당일 여행 (데모)` trip (new id each time), so
  re-capture `TRIP_ID`.
- **Two "닫기" buttons** in the banner (text button + aria-label "배너 닫기" ✕)
  and the FAB shares aria-label "AI 재계획" with the banner button. The driver
  scopes clicks to `div.fixed.z-40` (the banner container) to avoid strict-mode
  ambiguity — do the same if you extend it.
- **The trip date is "today".** `seed:demo-live` sets an in-progress same-day
  trip so the planner and live screens have current data; don't expect it on
  other days.

## Troubleshooting

- `error while loading shared libraries: libnspr4.so` on browser launch →
  system libs missing, see Prerequisites.
- `browserType.launch: ... Target page/context/browser has been closed` right
  after launch → same missing-libs cause; the real error is a few lines up.
- Driver exits with `스모크 모드엔 TRIP_ID 필요` → run the seed step and export
  `TRIP_ID`.
- Blank/login screenshot → API or web not up, or session not injected; check
  `/tmp/tripick-api.log` / `/tmp/tripick-web.log` and the readiness poll above.
- `/api/v1/health` returns 404 — expected on this branch (no health route); use
  the connection poll shown above, not `curl -sf .../health`.
