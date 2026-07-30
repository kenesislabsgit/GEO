# Errors

## [ERR-20260721-001] playwright-auth-flow

**Logged**: 2026-07-21T00:00:00+05:30
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
The auth browser regression test could not launch because Playwright's Chromium executable is not installed.

### Error
```
browserType.launch: Executable doesn't exist at
C:\Users\Kenesis\AppData\Local\ms-playwright\chromium_headless_shell-1228\chrome-headless-shell-win64\chrome-headless-shell.exe
```

### Context
- Command: `npm.cmd exec playwright test tests/e2e/auth-flow.spec.ts --project=chromium --reporter=line`
- The Playwright package is installed, but its external browser runtime is absent.

### Suggested Fix
Run `npx playwright install chromium`, then rerun the auth flow test.

### Metadata
- Reproducible: yes
- Related Files: tests/e2e/auth-flow.spec.ts, playwright.config.ts

### Resolution
- **Resolved**: 2026-07-21T10:40:00+05:30
- **Notes**: Playwright now accepts `PLAYWRIGHT_EXECUTABLE_PATH`; the auth flow passed using the locally installed Chrome executable. The test base URL was also aligned to `localhost` so host-only auth cookies survive redirects.

---

## [ERR-20260723-001] windows-validation-tooling

**Logged**: 2026-07-23T13:20:00+05:30
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
Windows validation initially failed because PowerShell blocked `npm.ps1`, Playwright Chromium was missing, and a checkout test raced an in-flight redirect.

### Error
```
PSSecurityException: npm.ps1 cannot be loaded
browserType.launch: Executable doesn't exist
page.goto: net::ERR_ABORTED
```

### Context
- Use `npm.cmd` / `npx.cmd` under the managed PowerShell environment.
- Install the Playwright browser matching the package version.
- Wait for the exact checkout destination instead of matching the current broad `/dashboard/` URL and starting a second navigation.

### Suggested Fix
Use Windows command shims, install Chromium once, and assert the precise redirect target.

### Metadata
- Reproducible: yes
- Related Files: playwright.config.ts, tests/e2e/signed-in-scan.spec.ts

### Resolution
- **Resolved**: 2026-07-23T13:20:00+05:30
- **Notes**: Production build passed and all seven Playwright tests passed.

---

**Logged**: 2026-07-21T17:01:00+05:30
**Priority**: low
**Status**: resolved
**Area**: e2e tests

### Summary
The authentication flow test expected the former "New scan" heading after the product copy changed to "New audit".

### Error
```
expect(page.getByRole("heading", { name: /New scan/i })).toBeVisible()
```

### Resolution
- Updated the assertion to match the current "New audit" heading.
- The route transition itself succeeded; only the stale copy assertion failed.

---

## [ERR-20260721-002] vitest-cli-option

**Logged**: 2026-07-21T00:00:00+05:30
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
Vitest rejected the Jest-specific `--runInBand` option.

### Error
```
CACError: Unknown option `--runInBand`
```

### Context
- Command: `npm.cmd test -- --runInBand`
- This repository uses Vitest, not Jest.

### Suggested Fix
Run the repository's native `npm.cmd test` command without Jest flags.

### Metadata
- Reproducible: yes
- Related Files: package.json

### Resolution
- **Resolved**: 2026-07-21T00:00:00+05:30
- **Notes**: Reran with `npm.cmd test`.

---
