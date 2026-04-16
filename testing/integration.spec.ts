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
    await expect(orgPage.locator('text=Alice')).toBeVisible({ timeout: 20_000 });
    await expect(orgPage.locator('text=Dana')).toBeVisible({ timeout: 20_000 });
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

    // §11: All player names visible in the bracket from a player's perspective
    for (const name of ['Alice', 'Bob', 'Charlie', 'Dana']) {
      await expect(alicePage.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 5_000 });
    }
    console.log('✓ All 4 player names visible in bracket from player page');

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

  test('8b: 6-player bye bracket — shape, player states, and auto-advancement to Finals', async ({ browser }) => {
    test.setTimeout(90_000);
    const orgCtx = await browser.newContext();
    const orgPage = await orgCtx.newPage();

    await orgPage.goto('/');
    await orgPage.fill('#tournamentName', 'Bye Auto-Advance Test');
    await orgPage.fill('#boardCount', '2');
    await orgPage.click('button[type=submit]');
    await orgPage.waitForURL('**/tournament?id=**');

    const tournamentId = new URL(orgPage.url()).searchParams.get('id')!;
    const signupUrl = `${BASE}/tournament/${tournamentId}/signup`;

    // Collect player URLs (needed for 8d player-page assertions)
    const playerCtxs: { url: string; ctx: BrowserContext }[] = [];
    for (const name of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) {
      const { playerUrl, ctx } = await signUpPlayer(browser, signupUrl, name);
      playerCtxs.push({ url: playerUrl, ctx });
    }

    await expect(orgPage.locator('text=A6')).toBeVisible({ timeout: 10_000 });
    await orgPage.click('button:text("Start Tournament")');
    await orgPage.waitForURL('**/anthem');
    await orgPage.click('a:text("Continue to Bracket")');
    await orgPage.waitForURL('**/bracket');

    // Wait for bracket init: 1 regular match → 1 Start button
    await expect(orgPage.locator('button:text("Start")')).toBeVisible({ timeout: 10_000 });

    // 8a: 3 teams → bracketSize=4 → 1 bye, 1 regular
    await expect(orgPage.locator('text=Bye - Team 1 advances')).toHaveCount(1, { timeout: 10_000 });
    await expect(orgPage.locator('button:text("Start")')).toHaveCount(1, { timeout: 5_000 });
    console.log('✓ 1 bye match, exactly 1 Start button');

    // 8d: Navigate to all 6 player pages and count bye vs queue messages
    let byeCount = 0;
    let queueCount = 0;
    for (const { url, ctx } of playerCtxs) {
      const page = await ctx.newPage();
      await page.goto(url);
      await expect(page.locator('text=in progress')).toBeVisible({ timeout: 10_000 });
      const byeLoc = page.locator('text=You have a bye');
      const queueLoc = page.locator('text=in the queue');
      await expect(byeLoc.or(queueLoc)).toBeVisible({ timeout: 10_000 });
      if (await byeLoc.isVisible()) byeCount++;
      if (await queueLoc.isVisible()) queueCount++;
    }
    expect(byeCount).toBe(2);
    expect(queueCount).toBe(4);
    console.log(`✓ ${byeCount} bye players, ${queueCount} queued players`);

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
    await expect(orgPage.locator('button:text("Start")[disabled]')).toHaveCount(1);

    // §4: Click a waiting-match team card — must not produce a green highlight
    const greensBefore = await orgPage.locator('.bg-green-500').count();
    await orgPage.getByText('Team 1', { exact: true }).last().click({ force: true });
    await expect(orgPage.locator('.bg-green-500')).toHaveCount(greensBefore, { timeout: 1000 });
    console.log('✓ Click on waiting-match team is a no-op');

    // Select a winner in the first active match — board frees up, the 3rd Start becomes enabled
    await orgPage.locator('.cursor-pointer').first().click();
    await expect(orgPage.locator('button:text("Start"):not([disabled])')).toHaveCount(1, { timeout: 10_000 });
    console.log('✓ Board freed after winner selection');

    // Drive the bracket to Champions: alternately start any enabled match and pick winners
    // until the Champions banner appears. Generous loop ceiling to cover 3 remaining round-1
    // matches + later rounds. Champions is checked first so we exit immediately when it appears,
    // and cursor.click uses a short timeout+catch to avoid blocking on mid-transition cards.
    for (let i = 0; i < 30; i++) {
      if (await orgPage.locator('text=Champions').count() > 0) break;
      const enabledStart = orgPage.locator('button:text("Start"):not([disabled])');
      if (await enabledStart.count() > 0) {
        await enabledStart.first().click({ timeout: 3_000 }).catch(() => {});
      }
      if (await orgPage.locator('text=Champions').count() > 0) break;
      const cursor = orgPage.locator('.cursor-pointer');
      if (await cursor.count() > 0) {
        await cursor.first().click({ timeout: 3_000 }).catch(() => {});
      }
    }
    await expect(orgPage.locator('text=Champions')).toBeVisible({ timeout: 15_000 });
    console.log('✓ Champions banner reached');

    await Promise.all([orgCtx, ...ctxs].map(c => c.close()));
  });

  // ── §7: Browser notifications — fires when granted, no errors when denied ─
  test('§7: Browser notifications — fires when granted, no errors when denied', async ({ browser }) => {
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

    // Player 1: notification permission granted
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

    // Player 2: notification permission denied
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

    // Sign up 2 more players to fill out 2 teams of 2
    const otherCtxs: BrowserContext[] = [];
    for (const name of ['NP3', 'NP4']) {
      const { ctx } = await signUpPlayer(browser, signupUrl, name);
      otherCtxs.push(ctx);
    }

    await expect(orgPage.getByText('NP4', { exact: true })).toBeVisible({ timeout: 10_000 });
    await orgPage.click('button:text("Start Tournament")');
    await orgPage.waitForURL('**/anthem');
    await orgPage.click('a:text("Continue to Bracket")');
    await orgPage.waitForURL('**/bracket');
    await expect(orgPage.locator('button:text("Start"):not([disabled])')).toHaveCount(1, { timeout: 10_000 });

    // Reload both player pages so they re-mount after the tournament starts
    await notifPage.goto(notifPlayerUrl);
    await deniedPage.goto(deniedUrl);
    await expect(notifPage.locator('text=in the queue')).toBeVisible({ timeout: 10_000 });
    await expect(deniedPage.locator('text=in the queue')).toBeVisible({ timeout: 10_000 });

    // Start the only match — both players' matches transition waiting → active
    await orgPage.locator('button:text("Start"):not([disabled])').first().click();
    await expect(notifPage.locator('text=Your match is active')).toBeVisible({ timeout: 10_000 });
    await expect(deniedPage.locator('text=Your match is active')).toBeVisible({ timeout: 10_000 });

    // Granted: notification should have been recorded with the correct title
    await expect.poll(async () => {
      return await notifPage.evaluate(() => (window as any).__notifications?.length || 0);
    }, { timeout: 5_000 }).toBeGreaterThan(0);
    const notifications = await notifPage.evaluate(() => (window as any).__notifications);
    expect(notifications[0].title).toBe('Your game is starting!');
    console.log('✓ Notification fired with correct title');

    // Denied: no uncaught page errors
    expect(pageErrors).toEqual([]);
    console.log('✓ No uncaught errors when notification permission denied');

    await Promise.all([orgCtx, notifCtx, deniedCtx, ...otherCtxs].map(c => c.close()));
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

  // ── §10: Queue position correctness, persistence, and real-time updates ────
  // Covers §6 (decrement on match start), §9 (reload preserves position), and:
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

    // 8 players → 4 teams of 2 → 2 round-1 matches; no delays needed (local PocketBase)
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

    // 2 matches, 4 players each → positions 1 and 2 must each appear exactly 4 times
    const counts = new Map<number, number>();
    for (const { pos } of opened) counts.set(pos, (counts.get(pos) ?? 0) + 1);
    // 2 matches × 4 players per match: each position must appear exactly 4 times
    for (let p = 1; p <= 2; p++) {
      expect(counts.get(p), `position #${p} should appear exactly 4 times`).toBe(4);
    }
    console.log(`✓ Initial positions correct: ${opened.map(o => o.pos).sort((a,b) => a-b).join(',')}`);

    // §9: Reload preserves queue position (checked before any match starts)
    const reloadTarget = opened.find(o => o.pos > 1)!;
    const preReloadPos = reloadTarget.pos;
    await reloadTarget.page.reload();
    await expect(reloadTarget.page.locator('text=in the queue')).toBeVisible({ timeout: 10_000 });
    const reloadedText = await reloadTarget.page.locator('text=in the queue').first().textContent();
    const reloadedM = reloadedText?.match(/#(\d+)/);
    expect(reloadedM ? parseInt(reloadedM[1]) : 0).toBe(preReloadPos);
    console.log(`✓ Queue position #${preReloadPos} preserved across reload`);

    // Organizer starts whichever match the bracket renders first
    await orgPage.locator('button:text("Start"):not([disabled])').first().click();

    // Exactly 4 players (one full match) must see "Your match is active!" in real-time.
    // We don't assume which match the bracket renders first, so poll all 8 pages concurrently.
    const activeResults = await Promise.all(
      opened.map(({ page }) =>
        page.locator('text=Your match is active')
          .waitFor({ state: 'visible', timeout: 15_000 })
          .then(() => true).catch(() => false)
      )
    );
    expect(activeResults.filter(Boolean)).toHaveLength(4);
    console.log('✓ Exactly 4 players see "Your match is active!" in real-time');

    // The remaining 4 players are still in the queue — their position must have updated
    // to #1 (either they were already at #1, or they decremented from #2 because the
    // other match started and vacated the top slot).
    for (const { page } of opened.filter((_, i) => !activeResults[i])) {
      await expect.poll(async () => {
        const text = await page.locator('text=in the queue').first().textContent().catch(() => null);
        const m = text?.match(/#(\d+)/);
        return m ? parseInt(m[1]) : null;
      }, { timeout: 15_000 }).toBe(1);
    }
    console.log('✓ Remaining 4 players all show queue position #1 in real-time');

    await Promise.all([orgCtx, ...playerCtxs.map(p => p.ctx)].map(c => c.close()));
  });

});
