# Save & Print permission fix — release review

## Scope and findings

Read-only inspection of production confirmed that customer reservation checks `can('intake_create')`, while the canonical grant is `repair_create`. Ticket reservation currently has no corresponding permission check and grants anonymous execution. The draft requires canonical creation authorization for both kinds and keeps both permission spellings compatible. The user subsequently authorized implementation, GitHub publication, migrations and production deployment. Existing business records must remain unchanged.

## Exact files

- `site/assets/legacy/module-1.js`: canonical submit/reservation checks; contextual ticket/customer reservation errors; failed reservation retry; ticket storage failure prevents printing; printer failure reports that the ticket is already saved and resets the form to avoid accidental resubmission.
- `database/save-print-permissions.sql`: reviewed, unapplied transactional migration. Function and execution-grant changes only; no table or RLS-policy changes, data backfills, counter resets, or member-grant rewrites.
- `tests/workspace.test.cjs`: Save & Print for Developer, Owner, Manager, Employee, including restricted canonical/legacy grants; reservation errors leave tickets unchanged and do not print; printer-error handling.
- `tests/save-print-database.test.cjs`: isolated PostgreSQL test using PGlite 0.3.14, with membership/PIN fixtures, existing record-guard code and representative RLS policies.
- `docs/save-print-permission-review.md`: this review.

## Database functions

1. `phonefix_private.can(text)`: add only the reverse `intake_create` → `repair_create` alias. Existing `repair_create` → legacy grant mapping and membership, role, revocation, store, and PIN checks remain intact. Preserve authenticated-only execution.
2. `phonefix_private.reserve_identifier(text,bigint)`: require active, unlocked `repair_create` authorization before reserving either kind. Validate kind and minimum; retain locking, monotonic counters and non-truncating IDs beyond 9999. Remove anonymous execution.
3. `public.pf_reserve_ticket_id(bigint)`: retain the invoker wrapper; remove anonymous execution and grant authenticated execution only. Authorization remains inside the private function.
4. `public.pf_reserve_customer_id(bigint)`: retain the invoker wrapper and explicitly retain authenticated-only execution, using the corrected private function.

No extra inventory, payment, history-edit, customer-edit, or team permissions are needed to create a new customer/ticket and invoke receipt printing. Other actions keep their existing permissions.

## Validation

`node --test tests/*.test.cjs`: **58 passed, 0 failed**. After final SQL execution-grant tightening, the isolated database test was rerun and passed.

The local database test checks all four roles, restricted Manager/Employee grants using both permission names, no-grant/unrelated-grant denials, role privileges without changes, revoked and PIN-locked accounts, anonymous denial on both APIs, RLS-protected inserts, and ID formatting after 9999. Browser tests use mocked RPC responses and a print spy; they verify receipt preparation and print invocation, not a physical printer or live Supabase/Google Sheets round trip.

Local test dependency: `npm install --prefix /tmp/phonefix-sql-tests @electric-sql/pglite@0.3.14`. Existing browser tests use the repository's pre-existing `/tmp/phonefix-test-tools` JSDOM installation.

## Public check-in replacement and deployment order

The new `database/public-checkin.sql` supplies a constrained public submission API. It validates and bounds input, fixes store/price/status values server-side, limits submissions to five per phone per 24 hours and 120 overall per minute, and records the check-in and ticket allocation atomically. Repeating the same request UUID and payload returns the same ticket; changed payloads with that UUID are rejected. Anonymous callers cannot read the inbox, acknowledge submissions, or call the internal allocator.

`site/intake/index.html` submits to `pf_public_checkin_submit` instead of reserving a ticket independently. Authorized staff sessions poll pending submissions every 30 seconds and use existing stable-ID Google Sheets sync. Original submissions remain in Supabase; acknowledgement removes them only from the pending list. Existing local tickets are never replaced by inbox data. Google Sheets forwarding requires an open, unlocked staff workspace with repair creation access. As in the existing integration, a no-cors response confirms transport completion, not the Apps Script write result.

Stage the private allocator and new public functions first, publish the updated frontend, then apply the staff permission migration to remove anonymous reservation access. Older public pages must be refreshed. No RLS policies are removed or disabled and no existing ticket/customer rows are rewritten.

Additional files: `database/public-checkin.sql`, `site/intake/index.html`, `tests/public-checkin.test.cjs`.
