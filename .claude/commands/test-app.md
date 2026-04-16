Run the Shear Madness integration test suite by following these steps:

## Step 1 — Install Playwright if needed

Check whether `@playwright/test` is listed in package.json devDependencies. If it is missing, install it and the browser binaries:

```
npm install --save-dev @playwright/test
npx playwright install chromium
```

If it is already installed, skip this step.

## Step 2 — Start the local PocketBase instance

The integration tests run against a **local** PocketBase instance (not the live production server). Use the devcontainer script which handles downloading the binary, starting the server, importing the schema, disabling rate limits, and writing the Vite env file:

```
bash .devcontainer/start-pocketbase.sh
```

The script is idempotent — safe to run again if PocketBase is already running. It will restart it and re-apply the schema. When it completes, PocketBase is ready at `http://localhost:8090` and `.env.development.local` is set so Vite picks it up automatically.

## Step 3 — Run the tests

Execute the Playwright test suite using the config in the testing directory:

```
npx playwright test --config=testing/playwright.config.ts
```

The config will automatically start the Vite dev server on port 5173 if it is not already running (`reuseExistingServer: true`), so you do not need to start it manually.

## Step 4 — Report results

After the run completes, read the terminal output and report the results in this format:

For each test, print one line:
- ✅ PASS — <test name>
- ❌ FAIL — <test name>: <brief error>

Then print a summary: `X / Y tests passed`.

If any tests fail, examine the failure messages and suggest fixes.

## Notes

- Tests run with `headless: false` so you will see a browser window open. This is intentional.
- Each test creates real data in the **local** PocketBase instance at `http://localhost:8090` — not the production server. Rate limiting is disabled on the local instance so tests run without delays.
- The full flow test covers: tournament creation, player signup, real-time updates, board limiting, winner selection, round progression, queue position, and the Champions banner.
- If a test is flaky due to timing, increase the `timeout` in `testing/playwright.config.ts`.
