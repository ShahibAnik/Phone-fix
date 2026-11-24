# Phone Fix — project instructions

Store workspace for Phone Fix (Philadelphia). Production: https://phone-fix-site.vercel.app. Vercel project `phone-fix-site`, root directory `site/`, no build step.

## Ship workflow

1. Branch from `main` (`feature/…`, `fix/…`, `docs/…`). Never commit straight to `main`.
2. Push the branch and open a pull request. Vercel builds a preview deployment.
3. Share the preview link and wait for the owner to reply **"approved"**.
4. Only after "approved": merge to `main` and confirm production is READY.
5. Rollback: promote the previous production deployment in Vercel.

Database migrations (`database/*.sql`) and Apps Script files (`apps-script/`) are applied separately, never automatically, and only with explicit approval. Deploy only `site/`; never deploy `database/`, `tests/`, notes or backups.

When `site/` files change, bump their `?v=` version in `site/index.html` (and the legacy module version in `site/assets/workspace.js`) so browsers load the new files.

Record product decisions in `docs/DECISIONS.md` (next number after the last entry) and each shipped change in `docs/PROGRESS.md`.

## Tests

The tests load tools from fixed paths under `/tmp`. Install them once:

```sh
mkdir -p /tmp/phonefix-test-tools /tmp/phonefix-sql-tests
(cd /tmp/phonefix-test-tools && npm init -y && npm i jsdom@26.1.0)   # jsdom 27+ drops ResourceLoader
(cd /tmp/phonefix-sql-tests && npm init -y && npm i @electric-sql/pglite)
```

Run everything:

```sh
for f in tests/*.test.cjs; do node "$f"; done
```

- `tests/workspace.test.cjs` boots the full app in jsdom with the sample workspace (`?preview=1`).
- "single-file deliverable boots all seven original modules" needs `deliverables/index.html`, which is gitignored. It fails in a clean checkout. That is expected.
- `tests/*.sql` are rollback-only database fixtures. Run them only against a database where you are allowed to, inside a transaction.

The sample workspace (`?preview=1`) never reads or writes live data. Use it for manual and visual checks.

## Design rules

- Glass theme. Day mode is **Cherry Dawn**; night mode is **Black Cherry Silk**. Check every visual change in both modes and at phone width (390px) with no page-level horizontal scroll.
- **Printing must not change.** Leave the ticket and label print layouts (`pl-*`, `pr*` elements and print CSS) alone unless the owner asks for a print change.
- Never name storage or sync providers on any screen. Show only the sync status. A test enforces this.
- Developer accounts and developer wording are visible only to developers. In the Activity log, developer actions show as "System administrator".

## Device passcode rules

- Customer self check-in (`site/intake/`) requires the device passcode, so the technician can test the repair.
- Passcode inputs are `type="password"` with `autocomplete="off"`.
- Intake draft recovery never stores device passcodes.
- Show passcodes only where staff need them to work on the device, such as the self-check-in review card and the ticket. Never send them to logs, analytics or the activity log.

## Permissions

- Roles: developer, owner, manager, employee. Owners manage owners, managers and employees. Managers manage employees only, and only the permissions they already hold. No one can edit a developer account from the app.
- Every action is checked in the browser (`site/assets/permissions.js`, `site/assets/access.js`) and on the server (Supabase RPCs). Keep both in sync.

## Privacy

Keep credentials in their configured services, never in source. Never put personal email addresses in website code.
