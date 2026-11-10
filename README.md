# Phone Fix

Source for https://phone-fix-site.vercel.app.

- `site/`: deployable website (HTML, CSS, JavaScript).
- `database/`: Supabase migrations and functions.
- `apps-script/`: Google Sheets integrations.
- `tests/`: regression checks and database fixtures.
- `OPERATIONS-RELEASE.md`: deployment and verification notes.

## Deployment

Use the existing Vercel project `phone-fix-site`. Set Root Directory to `site`, Framework to Other, and leave Build Command and Output Directory empty. Database migrations and Apps Script updates are applied separately.

Keep private credentials in their configured services, never in source files.
