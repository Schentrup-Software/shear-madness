# Shear Madness — Claude Code Guide

## Project Overview

**Shear Madness** is a real-time tournament management app for Cornhole competitions. Organizers create tournaments, share QR codes for player sign-up, then run single-elimination brackets with live updates.

## Tech Stack

- **Frontend**: React 19, React Router 7 (SPA mode), TypeScript 5.8
- **Styling**: TailwindCSS 3.4
- **Build**: Vite 6.3
- **Backend**: PocketBase 0.26 (SQLite-based, real-time via WebSocket)
- **Deployment**: Docker (multi-stage build, embedded PocketBase)

## Commands

```bash
npm run dev        # Dev server at http://localhost:5173
npm run build      # Production build to /build
npm run typecheck  # TypeScript type check
npm start          # Serve production build
```

Dev environment connects to the live PocketBase instance at `https://shear-madness.schentrupsoftware.com`.

## Project Structure

```
app/
├── routes/              # Page-level route components
│   ├── home.tsx         # Landing page wrapper
│   ├── tournament.tsx   # Organizer dashboard (signup phase)
│   ├── signup.tsx       # Player signup form
│   ├── player.tsx       # Player bracket view (read-only)
│   └── tournamentBracket.tsx  # Organizer bracket management
├── backend/
│   ├── api.ts           # ALL PocketBase API calls — touch this for data changes
│   ├── pocketbaseClient.ts    # PocketBase client init
│   └── pb_schema.json   # PocketBase collection schema
├── components/
│   ├── Bracket.tsx      # Reusable bracket UI (used by organizer + player views)
│   ├── GoogleChatSettings.tsx  # Organizer connects/disconnects Google Chat
│   └── NotificationLog.tsx     # Chat DM delivery receipts
├── types/
│   └── tournament.ts    # Shared TypeScript interfaces (Team, Match)
└── welcome/
    └── welcome.tsx      # Home page with tournament creation form
```

## Routes

| Path | Component | Purpose |
|------|-----------|---------|
| `/` | `home.tsx` / `welcome.tsx` | Create a tournament |
| `/tournament?id={id}` | `tournament.tsx` | Organizer dashboard |
| `/tournament/{id}/signup` | `signup.tsx` | Player signs up |
| `/tournament/{id}/player` | `player.tsx` | Player views bracket |
| `/tournament/{id}/bracket` | `tournamentBracket.tsx` | Organizer manages bracket |

## Data Model (PocketBase Collections)

- `tournaments` — name, status (`signup` | `playing`), ownerId
- `players` — playerName, tournamentId, userId, chatEmail (optional Google Chat opt-in)
- `matches` — round, team1[], team2[], winningTeam, tournamentId
- `users` — temporary anonymous accounts (auto-created per session)
- `googleChatCredentials`, `googleChatDmSpaces`, `googleChatOauthStates` — server-only, API rules locked
- `matchNotifications` — DM delivery receipts, readable by the tournament owner

## Server-side Hooks (`pb_hooks/`)

PocketBase JS hooks provide the only server-side code in the app. `googlechat.pb.js`
registers the `/api/google-chat/*` OAuth routes plus the record hooks that DM players
through the tournament; `googlechat/lib.js` holds the shared logic.

Five message kinds, one per beat of the tournament (see `KIND` in `lib.js`):
`tournament_start` (anthem call, to everyone), `on_deck` (next teams in bracket
order, one match per board), `match_start` (you're up), `result` (congratulations
/ condolences), `tournament_end` (champions, to everyone). Each row in
`matchNotifications` records its kind, which is also what keeps the messages from
suppressing one another — sends are idempotent per player *and* kind.

PocketBase runs each handler in an isolated runtime — handlers **cannot** close over
outer-scope variables and must `require(`${__hooks}/googlechat/lib.js`)` instead.

Setup and behaviour are documented in [docs/google-chat-setup.md](docs/google-chat-setup.md).

## Key Architectural Patterns

### API Layer
All data access goes through `app/backend/api.ts`. Components never call PocketBase directly. Real-time subscriptions return an unsubscribe function for cleanup in `useEffect`.

### Authentication
Anonymous PocketBase accounts are auto-created and credentials cached in `localStorage`. No user-facing login flow.

### Real-time Updates
PocketBase WebSocket subscriptions (`players.*`, `matches.*`, `tournaments/{id}`) trigger callbacks that update React state. Components also manually refetch after mutations.

### Bracket Logic
- Single-elimination only
- Teams of 2 auto-paired from player list (randomized)
- Bracket size rounds up to next power of 2
- Bye matches auto-advance teams when no opponent
- Next round matches only created when all current-round matches are complete

### Bracket Component
`Bracket.tsx` is shared between organizer and player views:
- `isReadOnly` prop disables winner selection for player view
- `onSelectWinner` callback handles match results

## TypeScript Conventions

- Strict mode enabled
- Path alias `~/*` → `./app/*`
- Route components use `type Route` from auto-generated `.react-router/types/` — run `npm run typecheck` to regenerate if routes change
- Default exports for all route components

## Styling

- Tailwind utility classes throughout — no CSS modules
- Dark mode via `class` strategy (not media query)
- Global gradient background (blue-purple-pink) defined in `root.tsx`
- Inter font from Google Fonts

## Docker

The Dockerfile produces a self-contained image: React SPA built by Vite is served as PocketBase's public folder, with embedded PocketBase (v0.28.2) as the backend. Single port (8080) exposes everything.

## Verifying Work

Before marking any task complete, run the `test-app` skill to confirm the app still functions. Do not report work as done until the integration tests pass.
