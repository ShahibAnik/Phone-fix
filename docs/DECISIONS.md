# Decisions

Product and engineering decisions for Phone Fix. Add new entries at the end with the next number. Do not rewrite an accepted decision; add a new one that replaces it.

Earlier decisions (D001–D019) were recorded in handoff notes outside this repository. This log starts at D020.

## D020 — Compact repair queue, sync-status-only wording, team access privacy

**Date:** 2026-11-24
**Status:** Accepted

### Repair queue
- Each queue card shows only the queue number, customer name and phone model, plus a Paid/Due tick.
- An arrow button, or tapping the card, opens the full ticket: status, badges, phone, price, issue, time left, technician, ready-by, ticket number, customer profile link, flags, and the Start / Ready / Priority / Carry buttons.
- Open cards stay open when the board refreshes (open state is kept in memory per browser tab).
- The Paid tick uses the same save (`togglePaid`) and the same "record payment" permission (`payment_record` / legacy `ticket_pay`) as the Repair history tick. People without that permission see the Paid/Due badge only.
- Customer self-check-ins waiting for review still show the full card.

### Sync wording
- No screen names the storage or sync providers. The interface shows only the sync status: "Synced · All changes saved", "N changes waiting", "Syncing…", or "Needs attention".
- The Sync window has a single "Sync now" button.
- Syncing behavior is unchanged; only wording changed. Raw sync error text is no longer shown because it can include provider details.
- An automated test (`tests/workspace.test.cjs`) visits every page and fails if a provider name appears on screen or in interface strings.

### Team access privacy
- Developer accounts are visible only to developers. The Team page filters them out for everyone else, and all developer wording is removed from the screens non-developers see.
- In the Activity log, actions by a developer account show as "System administrator". Developer accounts are recognized by a SHA-256 digest of the email, so no address is included in the website code.
- Owners manage owners, managers and employees. Managers manage employees only, and only the permissions they already hold. Developers can change or remove anyone except another developer. No one can edit a developer account from the app.
- No database change. Server rules in `team_save` already enforce the same limits.

### Rollback
Promote the previous production deployment in Vercel. No data migration is involved.
