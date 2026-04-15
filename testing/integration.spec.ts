import { test, expect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';

const BASE = 'http://localhost:5173';


// Sign up a player in a fresh browser context and return their player page URL.
// Fails immediately if the signup form shows an error instead of waiting out the timeout.
async function signUpPlayer(browser: Browser, signupUrl: string, name: string): Promise<{ playerUrl: string; ctx: BrowserContext }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Capture browser-side errors for diagnostics
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`[browser:${name}] ${msg.text()}`);
  });

  await page.goto(signupUrl);
  await expect(page.locator('#playerName')).toBeVisible();
  await page.fill('#playerName', name);
  await page.click('button[type=submit]');

  // Race: either we land on the player page (success) or an error message appears (fail fast)
  await Promise.race([
    page.waitForURL('**/player'),
    page.waitForSelector('.text-red-600, .text-red-400', { state: 'visible' }).then(async (el) => {
      const msg = await el.textContent();
      throw new Error(`Signup failed for "${name}": ${msg?.trim()}`);
    }),
  ]);

  return { playerUrl: page.url(), ctx };
}

test.describe('Shear Madness — Full Tournament Flow', () => {

  test('1. Tournament creation — name and board count fields present', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#tournamentName')).toBeVisible();
    await expect(page.locator('#boardCount')).toBeVisible();
  });

  test('2. Tournament creation — submit blocked when name is empty', async ({ page }) => {
    await page.goto('/');
    await page.click('button[type=submit]');
    // Browser native validation prevents navigation
    await expect(page).toHaveURL('/');
  });

  test('3. Tournament creation — board count clamps to 1', async ({ page }) => {
    await page.goto('/');
    await page.fill('#boardCount', '0');
    await page.locator('#boardCount').blur();
    await expect(page.locator('#boardCount')).toHaveValue('1');
  });

  test('4–8. Full tournament flow: signup → bracket → board limiting → queue → notifications', async ({ browser }) => {
    test.setTimeout(60_000);
    // ── 4. Create tournament (boardCount=1 to test board limiting with 1 match) ───
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Integration Test Tournament');
    await orgPage.fill('#boardCount', '1');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    expect(tournamentId).toBeTruthy();
    console.log(`✓ Tournament created: ${tournamentId}`);

    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    // ── 5. Player signup — 4 players sequential (2 teams of 2, 1 match) ─────
    const { playerUrl: aliceUrl, ctx: aliceCtx } = await signUpPlayer(browser, signupUrl, 'Alice');
    const { playerUrl: bobUrl, ctx: bobCtx } = await signUpPlayer(browser, signupUrl, 'Bob');
    const { ctx: charlieCtx } = await signUpPlayer(browser, signupUrl, 'Charlie');
    const { ctx: danaCtx } = await signUpPlayer(browser, signupUrl, 'Dana');

    // Real-time: all 4 players visible on organizer page without reload
    await expect(orgPage.locator('text=Alice')).toBeVisible({ timeout: 10_000 });
    await expect(orgPage.locator('text=Dana')).toBeVisible({ timeout: 10_000 });
    console.log('✓ All 4 players visible on organizer page in real-time');

    // ── 6. Start Tournament ──────────────────────────────────────────────────
    await orgPage.click('button:text("Start Tournament")');
    await orgPage.waitForURL('**/anthem', { timeout: 10_000 });
    await orgPage.click('a:text("Continue to Bracket")');
    await orgPage.waitForURL('**/bracket', { timeout: 10_000 });
    console.log('✓ Tournament started, redirected to bracket');

    // ── Wait for bracket init (2 teams → 1 match → 1 Start button) ──────────
    const startButtons = orgPage.locator('button:text("Start")');
    await expect(startButtons).toHaveCount(1, { timeout: 10_000 });
    console.log('✓ First-round match created (bracket init complete)');

    // ── 7. Player page updates in real-time ─────────────────────────────────
    const alicePage = await aliceCtx.newPage();
    await alicePage.goto(aliceUrl);
    await expect(alicePage.locator('text=in progress')).toBeVisible({ timeout: 10_000 });
    console.log('✓ Player page shows tournament in progress');

    // ── 8. Queue position displayed on player page ───────────────────────────
    // Alice's match is waiting → she's #1 in the queue
    const queueCard = alicePage.locator('text=in the queue');
    await expect(queueCard).toBeVisible({ timeout: 10_000 });
    console.log('✓ Queue position card visible on player page');

    // ── 9. Board limiting: boardCount=1, start the match → board full ────────
    await startButtons.first().click();
    await expect(orgPage.locator('text=Active').first()).toBeVisible({ timeout: 5_000 });
    console.log('✓ Match shows Active badge after Start clicked');

    // No enabled Start buttons (the one board is occupied)
    await expect(orgPage.locator('button:text("Start"):not([disabled])')).toHaveCount(0);
    console.log('✓ No enabled Start buttons when board is full');

    // ── 12. Player page reflects active match (checked while match is active) ─
    const bobPage = await bobCtx.newPage();
    await bobPage.goto(bobUrl);
    // Match is currently active — Bob should see "Your match is active"
    await expect(bobPage.locator('text=Your match is active')).toBeVisible({ timeout: 10_000 });
    console.log('✓ Player page shows active match status');

    // ── 10. Winner selection on active match ─────────────────────────────────
    const team1Card = orgPage.locator('.cursor-pointer').first();
    await team1Card.click();
    await expect(orgPage.locator('.bg-green-500').first()).toBeVisible({ timeout: 5_000 });
    console.log('✓ Winner highlighted green after selection');

    // ── 11. With 2 teams the single match IS the finals ──────────────────────
    await expect(orgPage.locator('text=Finals')).toBeVisible({ timeout: 5_000 });
    console.log('✓ Finals label visible in bracket');

    // ── 13. Champions banner ─────────────────────────────────────────────────
    await expect(orgPage.locator('text=Champions')).toBeVisible({ timeout: 10_000 });
    console.log('✓ Champions banner visible after finals');

    // ── Cleanup ───────────────────────────────────────────────────────────────
    await Promise.all([orgCtx, aliceCtx, bobCtx, charlieCtx, danaCtx].map(c => c.close()));
  });

  test('Edge case: Start Tournament button disabled with odd player count', async ({ browser }) => {
    test.setTimeout(60_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Odd Players Test');
    await orgPage.fill('#boardCount', '1');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    // Sign up 3 players (odd) sequentially
    for (const name of ['P1', 'P2', 'P3']) {
      const { ctx } = await signUpPlayer(browser, signupUrl, name);
      await ctx.close();
    }

    await expect(orgPage.getByText('P3', { exact: true })).toBeVisible({ timeout: 10_000 });
    const startBtn = orgPage.locator('button:text("Start Tournament")');
    await expect(startBtn).toBeDisabled();
    console.log('✓ Start Tournament disabled with odd player count');

    await orgCtx.close();
  });

  // ── Bye tests (section 8) ────────────────────────────────────────────────

  test('8a: 6 players (3 teams) → 1 bye match + 1 regular match in round 1', async ({ browser }) => {
    test.setTimeout(60_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Bye Test 6 Players');
    await orgPage.fill('#boardCount', '2');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    const ctxs: BrowserContext[] = [];
    for (const name of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
      const { ctx } = await signUpPlayer(browser, signupUrl, name);
      ctxs.push(ctx);
    }

    await expect(orgPage.getByText('P6', { exact: true })).toBeVisible({ timeout: 10_000 });
    await orgPage.click('button:text("Start Tournament")');
    await orgPage.waitForURL('**/anthem');
    await orgPage.click('a:text("Continue to Bracket")');
    await orgPage.waitForURL('**/bracket');

    // 3 teams → bracketSize=4 → 1 bye, 1 regular
    await expect(orgPage.locator('text=Bye - Team 1 advances')).toHaveCount(1, { timeout: 10_000 });
    console.log('✓ 1 bye match visible in round 1');

    // Only the 1 regular match has a Start button; the bye match must not
    const startButtons = orgPage.locator('button:text("Start")');
    await expect(startButtons).toHaveCount(1, { timeout: 5_000 });
    console.log('✓ Exactly 1 Start button (bye match has none)');

    await Promise.all([orgCtx, ...ctxs].map(c => c.close()));
  });

  test('8b: Bye auto-advancement — completing the regular match creates a Finals match', async ({ browser }) => {
    test.setTimeout(60_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Bye Auto-Advance Test');
    await orgPage.fill('#boardCount', '2');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    const ctxs: BrowserContext[] = [];
    for (const name of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) {
      const { ctx } = await signUpPlayer(browser, signupUrl, name);
      ctxs.push(ctx);
    }

    await expect(orgPage.locator('text=A6')).toBeVisible({ timeout: 10_000 });
    await orgPage.click('button:text("Start Tournament")');
    await orgPage.waitForURL('**/anthem');
    await orgPage.click('a:text("Continue to Bracket")');
    await orgPage.waitForURL('**/bracket');

    // Wait for bracket init: 1 regular match → 1 Start button
    await expect(orgPage.locator('button:text("Start")')).toBeVisible({ timeout: 10_000 });

    // Start and complete the one regular match
    await orgPage.locator('button:text("Start")').click();
    await expect(orgPage.locator('text=Active').first()).toBeVisible({ timeout: 5_000 });

    // Click team 1 to select winner
    await orgPage.locator('.cursor-pointer').first().click();

    // Round 2 (Finals) should now appear — 1 match, no byes
    await expect(orgPage.getByRole('heading', { name: 'Finals', exact: true })).toBeVisible({ timeout: 10_000 });
    console.log('✓ Finals round created after bye auto-advancement');

    // No more "Bye - Team 1 advances" in round 2
    const byeTexts = orgPage.locator('text=Bye - Team 1 advances');
    await expect(byeTexts).toHaveCount(1); // still 1 from round 1, not 2
    console.log('✓ No new byes created in round 2');

    await Promise.all([orgCtx, ...ctxs].map(c => c.close()));
  });

  test('8d: Player page bye state — bye players see the bye message, not a queue position', async ({ browser }) => {
    test.setTimeout(60_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Bye Player Page Test');
    await orgPage.fill('#boardCount', '2');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    // Sign up 6 players and collect all player URLs
    const playerCtxs: { name: string; url: string; ctx: BrowserContext }[] = [];
    for (const name of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']) {
      const { playerUrl, ctx } = await signUpPlayer(browser, signupUrl, name);
      playerCtxs.push({ name, url: playerUrl, ctx });
    }

    await expect(orgPage.locator('text=B6')).toBeVisible({ timeout: 10_000 });
    await orgPage.click('button:text("Start Tournament")');
    await orgPage.waitForURL('**/anthem');
    await orgPage.click('a:text("Continue to Bracket")');
    await orgPage.waitForURL('**/bracket');

    // Wait for bracket init to finish before checking player pages
    await expect(orgPage.locator('button:text("Start")')).toBeVisible({ timeout: 10_000 });

    // Navigate to all 6 player pages and count how many show the bye/queue message
    let byeCount = 0;
    let queueCount = 0;
    for (const { url, ctx } of playerCtxs) {
      const page = await ctx.newPage();
      await page.goto(url);
      await expect(page.locator('text=in progress')).toBeVisible({ timeout: 10_000 });

      // Wait for match state to load (either bye message or queue position)
      const byeLoc = page.locator('text=You have a bye');
      const queueLoc = page.locator('text=in the queue');
      await expect(byeLoc.or(queueLoc)).toBeVisible({ timeout: 10_000 });

      if (await byeLoc.isVisible()) byeCount++;
      if (await queueLoc.isVisible()) queueCount++;
    }

    // 3 teams: 1 bye team (2 players) + 1 regular match (4 players)
    expect(byeCount).toBe(2);
    expect(queueCount).toBe(4);
    console.log(`✓ ${byeCount} bye players, ${queueCount} queued players`);

    await Promise.all([orgCtx, ...playerCtxs.map(p => p.ctx)].map(c => c.close()));
  });

  test('8e: Board count not consumed by byes — boardCount=1 with 6 players', async ({ browser }) => {
    test.setTimeout(60_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Bye Board Limit Test');
    await orgPage.fill('#boardCount', '1');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    const ctxs: BrowserContext[] = [];
    for (const name of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) {
      const { ctx } = await signUpPlayer(browser, signupUrl, name);
      ctxs.push(ctx);
    }

    await expect(orgPage.locator('text=C6')).toBeVisible({ timeout: 10_000 });
    await orgPage.click('button:text("Start Tournament")');
    await orgPage.waitForURL('**/anthem');
    await orgPage.click('a:text("Continue to Bracket")');
    await orgPage.waitForURL('**/bracket');

    // Only 1 real match → exactly 1 enabled Start button despite boardCount=1
    await expect(orgPage.locator('text=Bye - Team 1 advances')).toHaveCount(1, { timeout: 10_000 });
    const startBtn = orgPage.locator('button:text("Start"):not([disabled])');
    await expect(startBtn).toHaveCount(1, { timeout: 5_000 });
    console.log('✓ 1 enabled Start button — bye does not consume the board slot');

    // Use the board and confirm no more enabled Start buttons
    await startBtn.click();
    await expect(orgPage.locator('text=Active').first()).toBeVisible({ timeout: 5_000 });
    await expect(orgPage.locator('button:text("Start"):not([disabled])')).toHaveCount(0);
    console.log('✓ After starting the match, no enabled Start buttons remain');

    await Promise.all([orgCtx, ...ctxs].map(c => c.close()));
  });

  test('Edge case: Refresh bracket page — matches reload with correct statuses', async ({ browser }) => {
    test.setTimeout(60_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Refresh Test');
    await orgPage.fill('#boardCount', '1');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    for (const name of ['R1', 'R2', 'R3', 'R4']) {
      const { ctx } = await signUpPlayer(browser, signupUrl, name);
      await ctx.close();
    }

    await expect(orgPage.locator('text=R4')).toBeVisible({ timeout: 10_000 });
    await orgPage.click('button:text("Start Tournament")');
    await orgPage.waitForURL('**/anthem');
    await orgPage.click('a:text("Continue to Bracket")');
    await orgPage.waitForURL('**/bracket');

    // Wait for bracket init to finish before clicking Start
    await expect(orgPage.locator('button:text("Start")')).toBeVisible({ timeout: 10_000 });

    // Start a match and verify active state
    await orgPage.locator('button:text("Start")').first().click();
    await expect(orgPage.locator('text=Active').first()).toBeVisible({ timeout: 5_000 });

    // Reload and verify state persists
    await orgPage.reload();
    await expect(orgPage.locator('text=Active').first()).toBeVisible({ timeout: 10_000 });
    console.log('✓ Active match status persists after page reload');

    await orgCtx.close();
  });

  // ── §1: "Your Tournaments" table lists newly created tournament ─────────
  test('§1: Newly created tournament appears in Your Tournaments list', async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    const tournamentName = `My Tournament ${Date.now()}`;
    await page.goto('/');
    await page.fill('#tournamentName', tournamentName);
    await page.fill('#boardCount', '2');
    await page.click('button[type=submit]');
    await page.waitForURL('**/tournament?id=**');

    // Navigate back to the home page
    await page.goto('/');
    // Same browser context = same authenticated user → tournament should appear
    await expect(page.getByRole('heading', { name: 'Your Tournaments' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(tournamentName, { exact: true })).toBeVisible({ timeout: 10_000 });
    console.log('✓ Tournament appears in Your Tournaments table');

    await ctx.close();
  });

  // ── §2: Organizer can remove a player ───────────────────────────────────
  test('§2: Organizer can remove a player from the dashboard', async ({ browser }) => {
    test.setTimeout(60_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();
    // Auto-accept the window.confirm() dialog for removal
    orgPage.on('dialog', dialog => dialog.accept());

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Remove Player Test');
    await orgPage.fill('#boardCount', '1');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    const ctxs: BrowserContext[] = [];
    for (const name of ['Keeper', 'Goner']) {
      const { ctx } = await signUpPlayer(browser, signupUrl, name);
      ctxs.push(ctx);
    }

    await expect(orgPage.getByText('Goner', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(orgPage.getByText('Keeper', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Find the remove button next to "Goner" — the row's <li> contains both the name
    // span and the button[title="Remove player"]; force click since it's opacity-0 until hover.
    const gonerRow = orgPage.locator('li').filter({ hasText: 'Goner' });
    await gonerRow.locator('button[title="Remove player"]').click({ force: true });

    await expect(orgPage.getByText('Goner', { exact: true })).toBeHidden({ timeout: 10_000 });
    await expect(orgPage.getByText('Keeper', { exact: true })).toBeVisible();
    console.log('✓ Goner removed, Keeper remains');

    await Promise.all([orgCtx, ...ctxs].map(c => c.close()));
  });

  // ── §3: Start Tournament disabled with <4 players ───────────────────────
  test('§3: Start Tournament button disabled with 2 players (even but <4)', async ({ browser }) => {
    test.setTimeout(60_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Two Players Test');
    await orgPage.fill('#boardCount', '1');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    const ctxs: BrowserContext[] = [];
    for (const name of ['Solo1', 'Solo2']) {
      const { ctx } = await signUpPlayer(browser, signupUrl, name);
      ctxs.push(ctx);
    }

    await expect(orgPage.getByText('Solo2', { exact: true })).toBeVisible({ timeout: 10_000 });
    const startBtn = orgPage.locator('button:text("Start Tournament")');
    await expect(startBtn).toBeDisabled();
    console.log('✓ Start Tournament disabled with only 2 players');

    await Promise.all([orgCtx, ...ctxs].map(c => c.close()));
  });

  // ── §4: boardCount=2 board limiting ─────────────────────────────────────
  // Use 14 players → 7 teams → 1 bye + 3 regular round-1 matches → 3 startable matches.
  // boardCount=2 → 2 active + 1 disabled, exercising the limiting logic.
  test('§4: boardCount=2 — 2 matches active, remaining Start buttons disabled, waiting clicks no-op', async ({ browser }) => {
    test.setTimeout(180_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Board Limit 2 Test');
    await orgPage.fill('#boardCount', '2');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    const ctxs: BrowserContext[] = [];
    const playerNames = Array.from({ length: 14 }, (_, i) => `D${i + 1}`);
    for (const name of playerNames) {
      const { ctx } = await signUpPlayer(browser, signupUrl, name);
      ctxs.push(ctx);
    }

    await expect(orgPage.getByText('D14', { exact: true })).toBeVisible({ timeout: 10_000 });
    await orgPage.click('button:text("Start Tournament")');
    await orgPage.waitForURL('**/anthem');
    await orgPage.click('a:text("Continue to Bracket")');
    await orgPage.waitForURL('**/bracket');

    // 7 teams → 1 bye + 3 regular → 3 Start buttons (byes have none)
    const startButtons = orgPage.locator('button:text("Start")');
    await expect(startButtons).toHaveCount(3, { timeout: 10_000 });
    console.log('✓ 3 Start buttons visible (1 bye, 3 regular)');

    // Start 2 matches (boardCount=2 fills the board)
    await orgPage.locator('button:text("Start"):not([disabled])').first().click();
    await expect(orgPage.locator('text=Active')).toHaveCount(1, { timeout: 5_000 });
    await orgPage.locator('button:text("Start"):not([disabled])').first().click();
    await expect(orgPage.locator('text=Active')).toHaveCount(2, { timeout: 5_000 });
    console.log('✓ 2 matches Active');

    // Remaining Start button must be disabled
    await expect(orgPage.locator('button:text("Start"):not([disabled])')).toHaveCount(0);
    await expect(orgPage.locator('button:text("Start")[disabled]')).toHaveCount(1);
    console.log('✓ Remaining Start button disabled');

    // Click a team card in a waiting (non-active) match → no winner highlight should appear.
    // Active matches have .cursor-pointer on their team divs; waiting matches do not.
    // Verify by counting .bg-green-500 before/after the click.
    const greensBefore = await orgPage.locator('.bg-green-500').count();
    // Click the LAST visible "Team 1" text — that's in the still-waiting match
    await orgPage.getByText('Team 1', { exact: true }).last().click({ force: true });
    // Give the app a moment to process the click, then assert the count is unchanged
    await expect(orgPage.locator('.bg-green-500')).toHaveCount(greensBefore, { timeout: 1000 });
    console.log('✓ Click on waiting-match team is a no-op (no new green highlight)');

    await Promise.all([orgCtx, ...ctxs].map(c => c.close()));
  });

  // ── §5: Board freed after winner selection + full progression to Champions ─
  // 14 players → 7 teams → 1 bye + 3 regular round-1 matches.
  // boardCount=2 lets us start 2, then verify selecting a winner re-enables the 3rd.
  test('§5: Winner selection frees board; play through to Champions', async ({ browser }) => {
    test.setTimeout(240_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Full Progression Test');
    await orgPage.fill('#boardCount', '2');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    const ctxs: BrowserContext[] = [];
    const playerNames = Array.from({ length: 14 }, (_, i) => `E${i + 1}`);
    for (const name of playerNames) {
      const { ctx } = await signUpPlayer(browser, signupUrl, name);
      ctxs.push(ctx);
    }

    await expect(orgPage.getByText('E14', { exact: true })).toBeVisible({ timeout: 10_000 });
    await orgPage.click('button:text("Start Tournament")');
    await orgPage.waitForURL('**/anthem');
    await orgPage.click('a:text("Continue to Bracket")');
    await orgPage.waitForURL('**/bracket');
    // 1 bye + 3 regular = 3 Start buttons
    await expect(orgPage.locator('button:text("Start")')).toHaveCount(3, { timeout: 10_000 });

    // Start two matches (boardCount=2)
    await orgPage.locator('button:text("Start"):not([disabled])').first().click();
    await expect(orgPage.locator('text=Active')).toHaveCount(1, { timeout: 5_000 });
    await orgPage.locator('button:text("Start"):not([disabled])').first().click();
    await expect(orgPage.locator('text=Active')).toHaveCount(2, { timeout: 5_000 });
    // 3rd Start button is now disabled
    await expect(orgPage.locator('button:text("Start"):not([disabled])')).toHaveCount(0);

    // Select a winner in the first active match — board frees up, the 3rd Start becomes enabled
    await orgPage.locator('.cursor-pointer').first().click();
    await expect(orgPage.locator('button:text("Start"):not([disabled])')).toHaveCount(1, { timeout: 10_000 });
    console.log('✓ Board freed after winner selection');

    // Drive the bracket to Champions: alternately start any enabled match and pick winners
    // until the Champions banner appears. Generous loop ceiling to cover 3 remaining round-1
    // matches + later rounds.
    for (let i = 0; i < 30; i++) {
      const enabledStart = orgPage.locator('button:text("Start"):not([disabled])');
      if (await enabledStart.count() > 0) {
        await enabledStart.first().click();
      }
      const cursor = orgPage.locator('.cursor-pointer');
      if (await cursor.count() > 0) {
        await cursor.first().click();
      }
      if (await orgPage.locator('text=Champions').count() > 0) break;
    }
    await expect(orgPage.locator('text=Champions')).toBeVisible({ timeout: 15_000 });
    console.log('✓ Champions banner reached');

    await Promise.all([orgCtx, ...ctxs].map(c => c.close()));
  });

  // ── §6: Queue re-numbering across multiple players ──────────────────────
  test('§6: Queue position decrements in real-time when an earlier match starts', async ({ browser }) => {
    test.setTimeout(180_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Queue Renumber Test');
    await orgPage.fill('#boardCount', '1');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    const playerCtxs: { url: string; ctx: BrowserContext }[] = [];
    for (const name of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8']) {
      const { playerUrl, ctx } = await signUpPlayer(browser, signupUrl, name);
      playerCtxs.push({ url: playerUrl, ctx });
    }

    await expect(orgPage.getByText('Q8', { exact: true })).toBeVisible({ timeout: 10_000 });
    await orgPage.click('button:text("Start Tournament")');
    await orgPage.waitForURL('**/anthem');
    await orgPage.click('a:text("Continue to Bracket")');
    await orgPage.waitForURL('**/bracket');

    // Wait for round-1 Start buttons to render
    await expect(orgPage.locator('button:text("Start")').first()).toBeVisible({ timeout: 10_000 });

    // Open all 8 player pages and read their queue positions
    const opened: { page: Page; pos: number }[] = [];
    for (const { url, ctx } of playerCtxs) {
      const page = await ctx.newPage();
      await page.goto(url);
      await expect(page.locator('text=in the queue')).toBeVisible({ timeout: 10_000 });
      const text = await page.locator('text=in the queue').first().textContent();
      const m = text?.match(/#(\d+)/);
      const pos = m ? parseInt(m[1]) : 0;
      opened.push({ page, pos });
    }

    const positions = opened.map(o => o.pos).sort((a, b) => a - b);
    console.log(`Queue positions across players: ${positions.join(',')}`);
    expect(positions).toContain(1);
    // At least one player should show position > 1 (i.e. there are multiple matches queued)
    expect(positions.some(p => p > 1)).toBe(true);

    // Pick a player at position 2 to watch for real-time decrement
    const watcher = opened.find(o => o.pos === 2);
    expect(watcher).toBeTruthy();

    // Start the only enabled match (#1)
    await orgPage.locator('button:text("Start"):not([disabled])').first().click();

    // Watcher's position should decrement to 1 in real-time
    await expect.poll(async () => {
      const text = await watcher!.page.locator('text=in the queue').first().textContent().catch(() => null);
      const m = text?.match(/#(\d+)/);
      return m ? parseInt(m[1]) : null;
    }, { timeout: 15_000 }).toBe(1);
    console.log('✓ Queue position decremented #2 → #1 in real-time');

    await Promise.all([orgCtx, ...playerCtxs.map(p => p.ctx)].map(c => c.close()));
  });

  // ── §7: Browser notification fires when match starts ────────────────────
  test('§7: Browser notification fires when player\'s match starts', async ({ browser }) => {
    test.setTimeout(120_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Notification Test');
    await orgPage.fill('#boardCount', '1');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    // Create the notif player's context with notification permission and an injected stub
    const notifCtx = await browser.newContext({ permissions: ['notifications'] });
    await notifCtx.addInitScript(() => {
      (window as any).__notifications = [];
      class FakeNotification {
        static permission = 'granted';
        static requestPermission = () => Promise.resolve('granted');
        constructor(title: string, options?: any) {
          (window as any).__notifications.push({ title, options });
        }
      }
      (window as any).Notification = FakeNotification;
    });

    const notifPage = await notifCtx.newPage();
    await notifPage.goto(signupUrl);
    await expect(notifPage.locator('#playerName')).toBeVisible();
    await notifPage.fill('#playerName', 'NotifPlayer');
    await notifPage.click('button[type=submit]');
    await notifPage.waitForURL('**/player');
    const notifPlayerUrl = notifPage.url();

    // Sign up 3 more players to make 4 total (= 1 match with notif player in it, since teams of 2 from 4 = 2 teams = 1 match)
    const otherCtxs: BrowserContext[] = [];
    for (const name of ['NP2', 'NP3', 'NP4']) {
      const { ctx } = await signUpPlayer(browser, signupUrl, name);
      otherCtxs.push(ctx);
    }

    await expect(orgPage.getByText('NP4', { exact: true })).toBeVisible({ timeout: 10_000 });
    await orgPage.click('button:text("Start Tournament")');
    await orgPage.waitForURL('**/anthem');
    await orgPage.click('a:text("Continue to Bracket")');
    await orgPage.waitForURL('**/bracket');
    await expect(orgPage.locator('button:text("Start"):not([disabled])')).toHaveCount(1, { timeout: 10_000 });

    // Reload the notif page so player.tsx re-mounts after tournament starts (subscription path triggers notif)
    await notifPage.goto(notifPlayerUrl);
    await expect(notifPage.locator('text=in the queue')).toBeVisible({ timeout: 10_000 });

    // Start the only match — NotifPlayer's match transitions waiting → active
    await orgPage.locator('button:text("Start"):not([disabled])').first().click();
    await expect(notifPage.locator('text=Your match is active')).toBeVisible({ timeout: 10_000 });

    // Notification should have been recorded
    await expect.poll(async () => {
      return await notifPage.evaluate(() => (window as any).__notifications?.length || 0);
    }, { timeout: 5_000 }).toBeGreaterThan(0);
    const notifications = await notifPage.evaluate(() => (window as any).__notifications);
    expect(notifications[0].title).toBe('Your game is starting!');
    console.log('✓ Notification fired with correct title');

    await Promise.all([orgCtx, notifCtx, ...otherCtxs].map(c => c.close()));
  });

  // ── §7b: No notification when permission denied; no uncaught errors ─────
  test('§7b: Match starts with notification permission denied — no errors', async ({ browser }) => {
    test.setTimeout(120_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Notification Denied Test');
    await orgPage.fill('#boardCount', '1');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    const deniedCtx = await browser.newContext();
    await deniedCtx.addInitScript(() => {
      class FakeNotification {
        static permission = 'denied';
        static requestPermission = () => Promise.resolve('denied');
        constructor() { /* should not be called */ }
      }
      (window as any).Notification = FakeNotification;
    });

    const pageErrors: string[] = [];
    const deniedPage = await deniedCtx.newPage();
    deniedPage.on('pageerror', err => pageErrors.push(err.message));

    await deniedPage.goto(signupUrl);
    await expect(deniedPage.locator('#playerName')).toBeVisible();
    await deniedPage.fill('#playerName', 'DeniedPlayer');
    await deniedPage.click('button[type=submit]');
    await deniedPage.waitForURL('**/player');
    const deniedUrl = deniedPage.url();

    const otherCtxs: BrowserContext[] = [];
    for (const name of ['DN2', 'DN3', 'DN4']) {
      const { ctx } = await signUpPlayer(browser, signupUrl, name);
      otherCtxs.push(ctx);
    }

    await expect(orgPage.getByText('DN4', { exact: true })).toBeVisible({ timeout: 10_000 });
    await orgPage.click('button:text("Start Tournament")');
    await orgPage.waitForURL('**/anthem');
    await orgPage.click('a:text("Continue to Bracket")');
    await orgPage.waitForURL('**/bracket');
    await expect(orgPage.locator('button:text("Start"):not([disabled])')).toHaveCount(1, { timeout: 10_000 });

    await deniedPage.goto(deniedUrl);
    await expect(deniedPage.locator('text=in the queue')).toBeVisible({ timeout: 10_000 });

    await orgPage.locator('button:text("Start"):not([disabled])').first().click();
    await expect(deniedPage.locator('text=Your match is active')).toBeVisible({ timeout: 10_000 });

    // No uncaught page errors should have been raised
    expect(pageErrors).toEqual([]);
    console.log('✓ No uncaught errors when notification permission denied');

    await Promise.all([orgCtx, deniedCtx, ...otherCtxs].map(c => c.close()));
  });

  // ── §8c: 10 players (5 teams) → 3 byes + 1 regular ──────────────────────
  test('§8c: 10 players (5 teams) → 3 byes + 1 regular round-1 match', async ({ browser }) => {
    test.setTimeout(120_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', '10 Player Bye Test');
    await orgPage.fill('#boardCount', '2');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    const ctxs: BrowserContext[] = [];
    for (const name of ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10']) {
      const { ctx } = await signUpPlayer(browser, signupUrl, name);
      ctxs.push(ctx);
    }

    await expect(orgPage.getByText('T10', { exact: true })).toBeVisible({ timeout: 10_000 });
    await orgPage.click('button:text("Start Tournament")');
    await orgPage.waitForURL('**/anthem');
    await orgPage.click('a:text("Continue to Bracket")');
    await orgPage.waitForURL('**/bracket');

    // 5 teams → bracketSize=8 → 3 byes + 1 regular
    await expect(orgPage.locator('text=Bye - Team 1 advances')).toHaveCount(3, { timeout: 10_000 });
    await expect(orgPage.locator('button:text("Start")')).toHaveCount(1, { timeout: 5_000 });
    console.log('✓ 3 bye matches + 1 regular Start button');

    await Promise.all([orgCtx, ...ctxs].map(c => c.close()));
  });

  // ── §9: Player page refresh preserves queue position ────────────────────
  test('§9: Player page queue position persists across reload', async ({ browser }) => {
    test.setTimeout(180_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Queue Persist Test');
    await orgPage.fill('#boardCount', '1');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    const playerCtxs: { url: string; ctx: BrowserContext }[] = [];
    for (const name of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']) {
      const { playerUrl, ctx } = await signUpPlayer(browser, signupUrl, name);
      playerCtxs.push({ url: playerUrl, ctx });
    }

    await expect(orgPage.getByText('S8', { exact: true })).toBeVisible({ timeout: 10_000 });
    await orgPage.click('button:text("Start Tournament")');
    await orgPage.waitForURL('**/anthem');
    await orgPage.click('a:text("Continue to Bracket")');
    await orgPage.waitForURL('**/bracket');
    await expect(orgPage.locator('button:text("Start")').first()).toBeVisible({ timeout: 10_000 });

    // Pick the last player to maximize chance of a >1 queue position
    const { url, ctx } = playerCtxs[playerCtxs.length - 1];
    const page = await ctx.newPage();
    await page.goto(url);
    await expect(page.locator('text=in the queue')).toBeVisible({ timeout: 10_000 });

    const before = await page.locator('text=in the queue').first().textContent();
    const beforeMatch = before?.match(/#(\d+)/);
    const beforePos = beforeMatch ? parseInt(beforeMatch[1]) : 0;
    expect(beforePos).toBeGreaterThan(0);
    console.log(`Queue position before reload: #${beforePos}`);

    await page.reload();
    await expect(page.locator('text=in the queue')).toBeVisible({ timeout: 10_000 });
    const after = await page.locator('text=in the queue').first().textContent();
    const afterMatch = after?.match(/#(\d+)/);
    const afterPos = afterMatch ? parseInt(afterMatch[1]) : 0;
    expect(afterPos).toBe(beforePos);
    console.log(`✓ Queue position #${afterPos} preserved across reload`);

    await Promise.all([orgCtx, ...playerCtxs.map(p => p.ctx)].map(c => c.close()));
  });

  // ── §10: All players show correct unique positions; active match updates in real-time ─
  // §6 verifies one player's position decrements. This test verifies:
  //   a) All 8 players start with the correct positions (1–4, each appearing exactly twice).
  //   b) When the organizer starts match 1, the two players in that match immediately see
  //      "Your match is active!" (no refresh), and a position-#2 player drops to #1.
  test('§10: All players show correct initial queue positions; active match updates in real-time', async ({ browser }) => {
    test.setTimeout(120_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Queue All Positions Test');
    await orgPage.fill('#boardCount', '1');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    // 8 players → 4 matches; no delays needed (local PocketBase, no rate limits)
    const playerCtxs: { url: string; ctx: BrowserContext }[] = [];
    for (const name of ['PA1', 'PA2', 'PA3', 'PA4', 'PA5', 'PA6', 'PA7', 'PA8']) {
      const { playerUrl, ctx } = await signUpPlayer(browser, signupUrl, name);
      playerCtxs.push({ url: playerUrl, ctx });
    }

    await expect(orgPage.getByText('PA8', { exact: true })).toBeVisible({ timeout: 10_000 });
    await orgPage.click('button:text("Start Tournament")');
    await orgPage.waitForURL('**/anthem');
    await orgPage.click('a:text("Continue to Bracket")');
    await orgPage.waitForURL('**/bracket');
    await expect(orgPage.locator('button:text("Start")').first()).toBeVisible({ timeout: 10_000 });

    // Open all 8 player pages and record initial queue positions
    const opened: { page: Page; pos: number }[] = [];
    for (const { url, ctx } of playerCtxs) {
      const page = await ctx.newPage();
      await page.goto(url);
      await expect(page.locator('text=in the queue')).toBeVisible({ timeout: 10_000 });
      const text = await page.locator('text=in the queue').first().textContent();
      const m = text?.match(/#(\d+)/);
      opened.push({ page, pos: m ? parseInt(m[1]) : 0 });
    }

    // Each position 1–4 must appear exactly twice (one per match, two players per match)
    const counts = new Map<number, number>();
    for (const { pos } of opened) counts.set(pos, (counts.get(pos) ?? 0) + 1);
    for (let p = 1; p <= 4; p++) {
      expect(counts.get(p), `position #${p} should appear exactly twice`).toBe(2);
    }
    console.log(`✓ Initial positions correct: ${opened.map(o => o.pos).sort((a,b) => a-b).join(',')}`);

    // Identify the two players at position #1 (they are in the first match to be played)
    const posOnePlayers = opened.filter(o => o.pos === 1);
    expect(posOnePlayers).toHaveLength(2);

    // Pick one position-#2 player to watch for real-time decrement
    const posTwoPlayer = opened.find(o => o.pos === 2)!;

    // Organizer starts the first match (the one that is #1 in queue)
    await orgPage.locator('button:text("Start"):not([disabled])').first().click();

    // Position-#1 players must see "Your match is active!" in real-time (no refresh)
    for (const { page } of posOnePlayers) {
      await expect(page.locator('text=Your match is active')).toBeVisible({ timeout: 15_000 });
    }
    console.log('✓ Both position-#1 players see "Your match is active!" in real-time');

    // Position-#2 player must decrement to #1 in real-time
    await expect.poll(async () => {
      const text = await posTwoPlayer.page.locator('text=in the queue').first().textContent().catch(() => null);
      const m = text?.match(/#(\d+)/);
      return m ? parseInt(m[1]) : null;
    }, { timeout: 15_000 }).toBe(1);
    console.log('✓ Position-#2 player decremented to #1 in real-time');

    await Promise.all([orgCtx, ...playerCtxs.map(p => p.ctx)].map(c => c.close()));
  });

  // ── §11: Player page shows all other players' names in the bracket ────────
  // Verifies the PocketBase listRule fix: players can view each other's records,
  // so the bracket renders everyone's name — not just the signed-in player's.
  test('§11: Player page shows all other players\' names in the bracket', async ({ browser }) => {
    test.setTimeout(90_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Player Names Visibility Test');
    await orgPage.fill('#boardCount', '1');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    // 4 players → 1 match; collect all player page URLs
    const names = ['Aardvark', 'Bison', 'Cougar', 'Dingo'];
    const playerCtxs: { name: string; url: string; ctx: BrowserContext }[] = [];
    for (const name of names) {
      const { playerUrl, ctx } = await signUpPlayer(browser, signupUrl, name);
      playerCtxs.push({ name, url: playerUrl, ctx });
    }

    await expect(orgPage.getByText('Dingo', { exact: true })).toBeVisible({ timeout: 10_000 });
    await orgPage.click('button:text("Start Tournament")');
    await orgPage.waitForURL('**/anthem');
    await orgPage.click('a:text("Continue to Bracket")');
    await orgPage.waitForURL('**/bracket');
    await expect(orgPage.locator('button:text("Start")')).toBeVisible({ timeout: 10_000 });

    // Check each player's page: every player must see ALL four names in the bracket,
    // including the three players they did not sign in as.
    for (const { name: signedInName, url, ctx } of playerCtxs) {
      const page = await ctx.newPage();
      await page.goto(url);
      await expect(page.locator('text=Tournament Bracket')).toBeVisible({ timeout: 10_000 });

      for (const expectedName of names) {
        await expect(
          page.getByText(expectedName, { exact: true }),
          `${signedInName}'s page should show "${expectedName}"`
        ).toBeVisible({ timeout: 10_000 });
      }
      console.log(`✓ ${signedInName}'s page shows all 4 player names`);
    }

    await Promise.all([orgCtx, ...playerCtxs.map(p => p.ctx)].map(c => c.close()));
  });

});
