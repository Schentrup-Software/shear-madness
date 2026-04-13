# Manual Integration Test Plan

## Setup

1. Run `npm run dev` — confirm app loads at `http://localhost:5173`
2. Open a second browser or incognito window for the player perspective

---

## 1. Tournament Creation

- [ ] Go to `/` — confirm the creation form shows **Tournament Name** and **Number of Boards** fields
- [ ] Submit with name empty — confirm it's blocked (required field)
- [ ] Submit with board count < 1 — confirm it clamps to 1
- [ ] Create a tournament with name "Test" and 2 boards — confirm redirect to `/tournament?id=...`
- [ ] Go back to `/` — confirm "Test" appears in the Your Tournaments table

---

## 2. Player Signup

- [ ] On the organizer dashboard, copy the signup URL (or scan QR code)
- [ ] Open the signup URL in the second window — confirm the form loads
- [ ] Sign up 4 players (e.g. Alice, Bob, Charlie, Dana — 2 per window to simulate different users)
- [ ] Confirm each new player appears in the organizer's list in real-time (without refresh)
- [ ] Try removing a player from the organizer dashboard — confirm they disappear

---

## 3. Starting the Tournament

- [ ] With an odd number of players, confirm the **Start Tournament** button is disabled
- [ ] With fewer than 4 players, confirm it's disabled
- [ ] With 4 players, confirm the button is enabled — click it
- [ ] Confirm redirect to `/tournament/{id}/bracket`
- [ ] Open a player's URL (`/tournament/{id}/player/{playerId}`) in the second window — confirm it transitions from "registered" to showing the bracket in real-time

---

## 4. Bracket — Board Limiting (boardCount = 2)

- [ ] Confirm all first-round matches show a **Start** button (not Active badge)
- [ ] Click **Start** on match 1 — confirm it shows the green **Active** badge, team boxes become clickable
- [ ] Click **Start** on match 2 — confirm it becomes Active
- [ ] Confirm the **Start** button on remaining matches is now **disabled** (2 boards full)
- [ ] Try clicking a team in a `waiting` match — confirm nothing happens (click is blocked)

---

## 5. Bracket — Winner Selection & Round Progression

- [ ] Click a team in an **active** match to select the winner — confirm it highlights green
- [ ] Confirm that match's Start button disappears and a new match's Start button becomes enabled (a board freed up)
- [ ] Complete all first-round matches — confirm round 2 matches are automatically created
- [ ] Play through to the final — confirm the **Champions** banner appears

---

## 6. Player Page — Queue Position

- [ ] Open two player pages side-by-side (different players)
- [ ] Before any match is started, confirm each player sees their queue position (e.g. "#1 in the queue", "#2 in the queue")
- [ ] Start a match from the organizer tab — confirm the affected player's card changes to **"Your match is active!"** without a page refresh
- [ ] Confirm other players' queue positions update (e.g. #2 becomes #1) in real-time
- [ ] Confirm a player with a bye sees "You have a bye — you advance automatically"

---

## 7. Browser Notifications

- [ ] Open a player page — confirm the browser prompts for notification permission
- [ ] Grant permission
- [ ] From the organizer tab, start the match that player is in
- [ ] Confirm a browser notification fires: **"Your game is starting!"**
- [ ] Deny permission on another player's page — confirm no notification fires (no errors either)

---

## 8. Byes — Bracket Creation

> Teams consist of 2 players each. Byes are determined by team count (not player count).

### 8a. Minimum bye scenario (6 players = 3 teams → 1 bye, 1 regular match)

- [ ] Sign up **6 players** and start the tournament (3 teams → bracketSize = 4 → 1 bye)
- [ ] Confirm round 1 shows **2 matches total**: 1 bye match and 1 regular match
- [ ] Confirm the bye match shows **"Bye - Team 1 advances"** where team 2 would appear (no opponent slot)
- [ ] Confirm the bye match has **no Start button** (byes don't need a board)
- [ ] Confirm only the 1 regular match has a **Start** button
- [ ] Start the regular match — confirm boardCount is not affected by the bye match

### 8b. Bye auto-advancement into round 2

- [ ] With 6 players (1 bye + 1 regular), select a winner in the regular match
- [ ] Confirm round 2 (the **Finals**) is **immediately created** with 1 match pairing the bye winner vs the regular match winner
- [ ] Confirm **no byes appear in round 2** — the Finals match is team vs team

### 8c. Power-of-2 scenarios — correct bye and match counts

| Individual players | Teams | Expected byes | Expected round-1 matches     |
|--------------------|-------|--------------|------------------------------|
| 4                  | 2     | 0            | 2 regular                    |
| 6                  | 3     | 1            | 1 bye + 1 regular            |
| 8                  | 4     | 0            | 4 regular                    |
| 10                 | 5     | 3            | 3 bye + 1 regular            |
| 12                 | 6     | 2            | 2 bye + 2 regular            |
| 14                 | 7     | 1            | 1 bye + 3 regular            |
| 16                 | 8     | 0            | 4 regular (no byes)          |

- [ ] Test at least **2** of the above player counts and verify the match counts match the table

### 8d. Player page — bye state

- [ ] Sign up **6 players**, start the tournament
- [ ] Open the player pages for all 6 players — **2 players** (the bye team) should show **"You have a bye — you advance automatically"** (not a queue position number)
- [ ] Confirm the bye players do **not** see "Your match is active!" (byes are never started)
- [ ] Confirm the 4 players in the regular match see a valid queue position (bye players not counted in queue)

### 8e. Board count not consumed by byes

- [ ] Create a tournament with **boardCount = 1** and **6 players** (3 teams → 1 bye + 1 regular)
- [ ] Confirm only the 1 real match has a Start button; clicking it uses the only board
- [ ] Confirm the bye match never shows a Start button and does not count toward the active board limit

---

## 9. Edge Cases

- [ ] Refresh the bracket page mid-tournament — confirm matches reload correctly with proper statuses
- [ ] Refresh a player page — confirm queue position is correct after reload
- [ ] With boardCount = 1, confirm only one match can be active at a time
