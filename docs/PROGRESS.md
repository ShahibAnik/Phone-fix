# Progress

Newest first. Each entry says what changed, where it stands, and how it was checked.

## 2026-11-24 — Queue cards, sync wording, team privacy (D020)

Branch `feature/queue-sync-team-privacy`. Goes live only after a Vercel preview is approved.

- **Repair queue:** compact cards (queue number, name, model) with a Paid/Due tick; the arrow or a tap opens the full ticket, and open cards stay open on refresh. Self-check-ins keep the full card.
- **Sync status only:** provider names removed from the status bar, Sync window, Settings, Inventory and Credit headings, Team page, record edit/remove messages, toasts and errors. The Sync window has one "Sync now" button.
- **Team privacy:** developer rows and wording are hidden from non-developers; developer actions show as "System administrator" in the Activity log. Role limits are unchanged and are now covered by tests.
- **Asset versions** bumped to `20261124a` so browsers load the new files.

Checks:
- Node tests: apps-script 4/4, commerce 5/5, operations-sheet 2/2, operations 4/4, public-checkin 1/1, save-print-database 1/1, sync 7/7, workspace 40/41.
- The one failure, "single-file deliverable boots all seven original modules", was already failing: it needs `deliverables/index.html`, which is gitignored and not in the repository.
- New tests: provider-name guard, sync status wording, compact queue (open/close, persists across refresh, Paid tick save, permission denial), team privacy (visibility, role limits, Activity log label).
- Visual check in headless Chrome at 1440×900 and 390×844 (sample workspace): no page-level horizontal scroll and no script errors.
