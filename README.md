# Coffee Roulette ☕

> Automatic coworker coffee chat introductions for Slack teams.

Employees join a Slack channel to opt in. On a recurring schedule, the bot randomly pairs people and sends a group DM introducing them. No spreadsheets, no manual coordination.

---

## Project structure

```
src/
  index.ts              # App entry point
  db/
    pool.ts             # Postgres connection pool
    migrate.ts          # Schema migrations (run once)
    participants.ts     # Participant queries
    workspaces.ts       # Workspace + program queries
  handlers/
    optIn.ts            # Channel join/leave events → opt-in/out
    commands.ts         # /coffee slash command
  jobs/                 # (next) Matching scheduler
  utils/                # (next) Helpers
```

---

## Setup

### 1. Create your Slack app

1. Go to https://api.slack.com/apps and click **Create New App → From scratch**
2. Under **OAuth & Permissions**, add these bot token scopes:
   - `channels:read` — read public channel membership
   - `groups:read` — read private channel membership
   - `chat:write` — send messages and DMs
   - `im:write` — open DM channels
   - `users:read` — look up user info
3. Under **Event Subscriptions**, enable and subscribe to:
   - `member_joined_channel`
   - `member_left_channel`
4. Under **Slash Commands**, create `/coffee`
5. Install the app to your workspace — copy the **Bot Token** (`xoxb-...`)
6. Copy the **Signing Secret** from Basic Information
7. For local dev, enable **Socket Mode** and create an **App-Level Token** (`xapp-...`)

### 2. Configure environment

```bash
cp .env.example .env
# Fill in SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN, DATABASE_URL
```

### 3. Set up the database

```bash
# Create the database
createdb coffee_roulette

# Run migrations
npm run db:migrate
```

### 4. Run locally

```bash
npm install
npm run dev
```

---

## How opt-in works

The opt-in model is **channel-based** — no sign-up form needed:

| Action | Result |
|--------|--------|
| User joins `#coffee-chat` | Enrolled as active participant, receives welcome DM |
| User leaves `#coffee-chat` | Marked as opted out |
| User runs `/coffee snooze` | Skips next round, auto-resumes after |
| User runs `/coffee optout` | Removed from rotation (same as leaving channel) |

---

## Slash commands

| Command | Description |
|---------|-------------|
| `/coffee snooze` | Skip the next matching round |
| `/coffee optout` | Leave the rotation entirely |
| `/coffee status` | See your status and next match date |

---

## What's next

- [ ] `src/jobs/matcher.ts` — the core matching algorithm + cron scheduler
- [ ] `src/handlers/admin.ts` — `/coffee setup`, `/coffee pause`, `/coffee resume`
- [ ] Intro DM templates with icebreakers
- [ ] Admin reporting (`/coffee report`)
- [ ] "Did you meet?" follow-up check-in
