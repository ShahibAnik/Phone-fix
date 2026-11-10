# Phone Fix operations update — November 4, 2026

## Current state

Website implementation is in `site/`. Production is deployed and Google Sheets sync is active (see final activation below). The additive Supabase migration `daily_sales_attendance_payroll_customer_notes` has been applied to project `nqmpplbddzigosyzwmbt`. No existing business rows were changed.

A separate worker was saved as `Untitled.gs` in the existing Inventory Apps Script project `1MwBya0zAR-1TlFY8VfDr-QgIZCG8nPv9fpOzzDQN065gUXvIgui69j3m`. Existing Code.gs was not changed. The local, formatted equivalent is `apps-script/DailyOperations.gs`. It is activated with a scoped credential in Script properties and a five-minute time-based trigger. A temporary archived note was verified through Supabase → Sheets → acknowledged version, then removed from both destinations.

Destination requested by user: spreadsheet `1xAIQT635B6m38KxAFCpaJe97Ist4csrwROVoMSECW80`. Sharing inspection found restricted access for anikshahib@gmail.com (owner) and phonefixpenrose@gmail.com (editor). The user explicitly requested creating the tabs in this Inventory spreadsheet after sharing was explained. Do not ask again about the destination or require a separate management spreadsheet. User explicitly approved activation and deployment. Google authorization was completed by the user.

## Implemented

- Four queue lanes with drag/drop and existing stage buttons, Delivered column and backward correction. Existing fixed panel, carry, priority, printing and self-intake review retained.
- Hash-based routes survive refresh and support browser history; brand links to authorized Home/fallback.
- Daily Sales entries and analytics with distinct zero/missing dates and Home summary.
- Day attendance, effective-date daily rates, payroll adjustments, payment allocation date, actual payment date, partial payments and balances. Clock-in navigation removed in the follow-up; historical records retained.
- Customer flags/notes, normalized phone search, explicit customer selection, minimal contact records, resolution/archive history, optional internal five-star ratings. Profile, intake and repair cards show applicable active flags.
- Existing repair rating supports hover preview and keyboard selection.
- New records use Supabase RPCs with active membership/PIN checks, role enforcement, version checking, immutable audit records, unique daily entries and stable request IDs.
- Separate Apps Script worker mirrors only the new entities every five minutes after activation. Stable ID/version upserts, formula-text escaping, retry via unacknowledged versions, and conflict checks for existing tab layouts.

## Verification

- 34 Node tests passed: original 24 plus new calculation, UI and Sheet-worker cases.
- Rollback-only SQL fixtures passed: manager writes; employee own reads; denied payroll/attendance writes, other-user history, direct table access and anonymous reads; duplicate date and stale version refusal; employee note creation/resolution with text corrections denied; invalid connector-token refusal. Fixture changes were rolled back.
- Hosted sample Sales flow: 425 cash + 780 card + 65 other = 1270, analytics and saved log agree. Sample mode never writes to live backends.
- Local mobile iframe at 390px: page client/scroll width both 383px after scrollbar; queue board width 349px with internal 1122px scroll area, no whole-page horizontal overflow.
- Supabase advisor: new operations tables intentionally deny direct client access with RLS and revoked grants. SECURITY DEFINER RPC warnings are expected for explicitly authorized RPCs with internal checks. Connector RPCs require a 256-bit token whose hash is private. Existing unrelated auth/security warnings were not changed.

## Final activation and release

- Initial production release: dpl_CuGGdXQeqCKiKf25xUsmUFZAgkh4.
- Latest production update: dpl_6QaT34i4PgaWMiGBv2YvDYMjEUch, https://phone-fix-site.vercel.app, assets version 20261104c.
- Google trigger pfSyncDailyOperations is installed; trigger list showed a completed scheduled run and 0% error rate.
- Live test exposed pg-safeupdate rejecting an unqualified connector timestamp UPDATE. Fixed via migration operations_sync_ack_scoped_update; afterward the test row synced with version 1 / synced_version 1 and no error. Worker reports RPC name/status/error for diagnostics.
- New migration daily_sales_employee_attendance adds manager-only atomic sales/attendance saving. Employee checkboxes at the bottom of Daily Sales create missing Present days, preserve existing corrections, reject future attendance, and do not duplicate on retry. Clock attendance nav/link removed; old #attendance links redirect to #days. Historical clock records are unchanged.
- 35/35 Node tests pass. Rollback-only SQL tests passed atomic rollback for invalid employees, idempotent retry, deduplication, preserved half-day corrections, and employee write denial.
- Test-only archived note a11a0d00-2026-4000-8000-000000000001 was removed from Supabase and Customer Notes A2:X2 after verifying delivery.

## Boundaries

New records are edited in the website and mirrored to Sheets. Direct Sheet edits are not imported. Payroll tracks gross daily earnings and recorded payments, not taxes or bank transfers. Missing daily rates produce an incomplete payroll warning. New saves require a connection to Supabase; errors leave the form open for retry. The legacy Google repair/inventory sync remains separate and retains its existing no-cors limitations. Live Google sync is verified. A real authenticated website save has not been exercised; permissions and atomic saves were verified with rollback-only database fixtures. Sample preview data resets on refresh by design.

Backup: `backups/20261104/site/` contains the pre-change website. Deploy only `site/`; do not deploy database, tests, notes or backups.

Final preview: https://phone-fix-site-q1xy1z4nw-anikshahib-6030s-projects.vercel.app/?preview=1
Deployment: dpl_9LVavUBwT68NLoqNXmfMJhqzYJZZ (preview, not production).
Final test report: tests/operations-results.txt — 34/34 passing.

## Inventory tab creation verified

Created Daily Sales, Daily Attendance, Payroll Rates, Payroll Adjustments, Payroll Payments, and Customer Notes inside the requested Inventory spreadsheet. Each has the same 24-column header row expected by the worker, bold headers, and a frozen first row. Verified all six A1:X1 ranges by copying their visible cell values and comparing against PF_OPS_HEADERS; all matched. Google Sheets reported Saved to Drive. Existing Inventory, ToOrder, Accessories, PartUsage, SpecialOrders, StoreCredit, and Parts tabs remain present. New tabs contain headers only.

Post-deploy browser verification: latest production alias READY; sample Daily Sales form shows employee choices, saving a selected employee produces exactly one Present day and Days worked = 1. Clock attendance is absent from the navigation. Sample verification did not write business data.
