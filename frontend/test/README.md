# Optional browser smoke check

This additional check needs **Node.js 24**, the project's development dependencies, a production frontend build, **Playwright**, and a compatible **Chromium** executable. Playwright is intentionally not added to the locked application dependencies.

The script always starts its own loopback Express server with a fresh in-memory PGlite database and a randomly generated synthetic owner. It ignores provider environment variables, blocks all browser requests outside that loopback origin, and rejects provider fetches. It does not accept an existing dashboard URL. The sample job, reply and manual confirmation are fictional test records; no marketplace action is performed.

From the project root:

```bash
npm ci
npm run build --workspace frontend
```

Install the optional browser tooling in a separate temporary directory, for example on Linux or macOS:

```bash
npm install --prefix /tmp/freelance-browser-tools --no-save --package-lock=false playwright
/tmp/freelance-browser-tools/node_modules/.bin/playwright install chromium
PLAYWRIGHT_MODULE=/tmp/freelance-browser-tools/node_modules/playwright/index.mjs node frontend/test/browser-smoke.mjs
```

If Playwright is already resolvable from the project, omit `PLAYWRIGHT_MODULE`. A missing browser or missing operating-system browser library must be installed before running this check. The browser installation needs network access; the actual smoke journey runs locally.

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `PLAYWRIGHT_MODULE` | Absolute path to an existing Playwright module, or an installed package specifier. |
| `BROWSER_EXECUTABLE_PATH` | Existing Chromium binary, when using a separately installed browser. |
| `BROWSER_LAUNCH_ARGS` | JSON array of strings for explicit environment-specific Chromium launch arguments. |
| `BROWSER_ARTIFACT_DIR` | Directory for the JSON result and internal QA screenshots. Defaults to a newly created directory under the operating-system temporary directory. |

The 14-checkpoint journey covers login, all eleven sections at desktop and mobile widths, fictional JSON and CSV imports, deduplication, rule scoring, reviewed proposal preparation, a synthetic manual confirmation, readonly submission history, exact reply matching and classification, response drafting, missing-provider diagnostics, workflow controls, and three populated mobile views. It fails on any uncaught page error, outside browser request or provider fetch attempt. The browser, HTTP server and database are closed on completion or failure.

See `docs/testing.md` for the actual completed validation record. This replay script packages that journey with a reusable isolated server; it is an optional check, separate from `npm test`.
