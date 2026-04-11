# Changelog

## v0.2.0 - 2026-04-10

- Restored the app back to the correct `TATO / Turo` branding after mixed `Harborline` content was removed.
- Cleaned the main branch so stray listing pages and listing-specific Prisma schema no longer ship with the Turo admin app.
- Kept the Turo core flows in place: vehicle calendar, CSV import, offline orders, owner share links, and Stripe vehicle-slot billing.
- Created a backup branch for the mixed code before cleanup: `codex/backup-harborline-mix-20260410`.

## v0.1.0 - 2026-03-28

- Initial local MVP for the Turo admin backend.
- Added vehicles, owners, orders, calendar, CSV import, and owner share pages.
