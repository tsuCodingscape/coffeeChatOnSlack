# Coffee Roulette ☕

> Automatic coworker coffee chat introductions for Slack teams.

Employees join a Slack channel to opt in. On a recurring schedule, the bot randomly pairs people (avoiding repeat pairs and same-team pairs) and sends a group DM introducing them, complete with an icebreaker, a suggested meeting time, and a one-click calendar invite. No spreadsheets, no manual coordination.

---

## Project structure

```
src/
  index.ts                        # App entry point — Socket Mode (dev) vs HTTP + OAuth (production)
  db/
    pool.ts                       # Postgres connection pool
    migrate.ts                    # Migration runner — applies migrations/*.ts, tracked in schema_migrations
    migrations/                   # One file per schema change, applied in order, safe to re-run
    installations.ts              # Postgres-backed Slack OAuth InstallationStore (multi-workspace)
    participants.ts                # Participant queries
    workspaces.ts                  # Workspace + program queries
    matches.ts                     # Match/round persistence + repeat-prevention queries
    exclusions.ts                  # Team assignment queries (same-team match avoidance)
  handlers/
    optIn.ts                       # Channel join/leave events → opt-in/out, Zoom + timezone modals
    commands.ts                    # /coffee slash command (snooze, optout, status, zoom, timezone, history)
    admin.ts                       # /coffee-admin slash command (setup, pause, resume, team, report)
    feedback.ts                    # Interactive buttons — "We met!", icebreaker ratings
    install.ts                     # OAuth scopes + install/callback page config
  jobs/
    scheduler.ts                    # Polls every 60s for due programs + runs the daily nudge job
    matcher.ts                      # Builds a round's pairs and sends the intro DMs
    algorithm.ts                    # Pairing/scoring logic (repeat + same-team avoidance, priority)
    nudge.ts                        # Follow-up DM if a match hasn't confirmed meeting after 3+ days
  utils/
    icebreakers_weighted.ts         # Icebreaker question bank, weighted by 👍/👎 feedback
    schedule.ts                     # Next-run-date calculation per cadence
    timezone.ts                     # Meeting time suggestion across participants' timezones
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
   - `commands` — respond to slash commands
3. Under **Event Subscriptions**, enable and subscribe to:
   - `member_joined_channel`
   - `member_left_channel`
4. Under **Slash Commands**, create `/coffee` and `/coffee-admin`
5. Under **Interactivity & Shortcuts**, turn interactivity on (needed for the Zoom/timezone modals and message buttons)
6. Copy the **Client ID**, **Client Secret**, and **Signing Secret** from Basic Information — these back the OAuth install flow used in production (see `src/handlers/install.ts`, `src/db/installations.ts`)
7. For local dev, enable **Socket Mode** and create an **App-Level Token** (`xapp-...`), then install the app to your dev workspace and copy the **Bot Token** (`xoxb-...`)

### 2. Configure environment

```bash
cp .env.example .env
# Fill in the values — see .env.example for what each one is for
```

Locally you'll run in Socket Mode with a single static `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`. In production (`NODE_ENV=production`), the app switches to HTTP mode and uses the OAuth `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_STATE_SECRET` instead, so a single deployment can serve any number of Slack workspaces — each workspace's bot token is stored via the OAuth install flow rather than a static env var.

### 3. Set up the database

```bash
# Create the database
createdb coffee_roulette

# Apply all migrations (safe to re-run — already-applied migrations are skipped)
npm run db:migrate
```

New schema changes go in `src/db/migrations/` as a new numbered file exporting `name` and `up(client)`, then get added to the `MIGRATIONS` list in `src/db/migrate.ts`. Re-running `npm run db:migrate` in any environment (including Render's Shell) brings it fully up to date in one step.

### 4. Run locally

```bash
npm install
npm run dev
```

### 5. Installing to a workspace (production)

Once deployed, visiting `https://<your-host>/slack/install` starts the OAuth flow; Slack redirects back to `https://<your-host>/slack/oauth_redirect` to complete it. Make sure that redirect URL is added under **OAuth & Permissions → Redirect URLs** in your Slack app config. After installing, run `/coffee-admin setup` in the workspace to pick a channel and cadence.

---

## How opt-in works

The opt-in model is **channel-based** — no sign-up form needed:

| Action | Result |
|--------|--------|
| User joins the configured channel | Enrolled as active participant, receives welcome DM |
| User leaves the configured channel | Marked as opted out |
| User runs `/coffee snooze` | Skips next round, auto-resumes after |
| User runs `/coffee optout` | Removed from rotation (same as leaving channel) |
| User runs `/coffee rejoin` | Re-enters the rotation without re-joining the channel |

---

## Slash commands

### `/coffee` (everyone)

| Command | Description |
|---------|-------------|
| `/coffee status` | See your status and next match date |
| `/coffee zoom` | Add or update your Zoom link, shared with your match |
| `/coffee timezone` | Set your timezone, used to suggest a meeting time |
| `/coffee history` | See your last 5 matches and whether you met |
| `/coffee snooze` | Skip the next matching round |
| `/coffee optout` | Leave the rotation entirely |
| `/coffee rejoin` | Come back to the rotation |

### `/coffee-admin` (workspace admins)

| Command | Description |
|---------|-------------|
| `/coffee-admin setup` | Configure the channel, cadence, and intro message |
| `/coffee-admin pause` / `resume` | Pause or resume matching |
| `/coffee-admin status` | View current program config |
| `/coffee-admin team` | Assign team exclusion rules so teammates aren't matched together |
| `/coffee-admin report` | Usage stats — participation, confirmation rate, trend, top icebreakers |

---

## What's next

- [ ] Slack Enterprise Grid support (currently single-workspace installs only)
- [ ] "Did you meet?" analytics broken out by team/cadence, not just workspace-wide
- [ ] Configurable working-hours window per workspace (currently hardcoded 9am–5pm)
