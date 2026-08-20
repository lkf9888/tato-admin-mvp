# Turo browser agent

Reads what the mailbox cannot see and pushes it into TATO.

## Why this exists

Turo emails a notification when a guest writes to you. It sends nothing
when **you** reply. So every conversation in TATO is one-sided: the
guest's words are there and yours are not.

That is not a gap in the parsing — it is a gap in the source. There is
no email to read, and no API to ask. The only place your replies exist
is the Turo website, logged in as you.

Two consequences that show up in the product:

- The unanswered count runs high, because a thread you answered an hour
  ago still looks unanswered.
- A drafted reply cannot see whether the same question was already
  answered, so it may answer it again.

## Why it does not run on Railway

Turo blocks automated traffic. A plain request from a server gets a 403
before it reaches a login page — verified. Headless Chrome in a
container is the shape that detection is looking for.

So this runs **on your own machine**, in a real browser window, using a
session you logged into by hand. It is the same approach the Airbnb
research script in HostHub uses, for the same reason.

## What it needs

- Node 20+ and `npx playwright install chromium`
- A TATO agent token (Account settings → agent tokens, or
  `POST /api/agent/tokens`). Shown once; it is stored hashed.

## Setting up, once

```bash
export TATO_URL=https://tatocar.co
export TATO_AGENT_TOKEN=tato_...
node agent/turo-agent.mjs --login
```

A browser window opens. Log into Turo by hand — including any 2FA. When
you are on the host dashboard, press Enter in the terminal. The session
is saved to `agent/.state/turo.json`.

**That file is a live login to your Turo account.** It is gitignored.
Treat it like a password.

## Running

```bash
node agent/turo-agent.mjs --conversations --limit 20
```

Opens the most recent conversations, reads both sides, and pushes them
to TATO. Idempotent: re-reading a thread updates rather than
duplicates, so running it often is harmless.

Add `--headed` to watch it work. Leave it off and it still uses a real
browser profile — just without the window.

## What will break it

Turo's markup. The selectors below are the parts that will need
changing when they redesign, and the script is written to **fail loudly
rather than silently return nothing**: an empty conversation and a
broken selector look identical in the data, and only one of them is
worth waking up for.

## The part you own

Turo's terms generally prohibit automated access. The data here is your
own business's, from your own account, but the account risk is yours.
Run it at a human pace — the defaults are deliberately unhurried — and
do not point it at anything that is not yours.
