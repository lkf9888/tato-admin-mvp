# Changelog

## v0.5.0 - 2026-04-12

- Refreshed the TATO UI with a more Turo-inspired visual direction: warmer ivory surfaces, darker ink panels, softer coral accents, and more spacious rounded layouts.
- Restyled the login and register pages to feel closer to Turo's brand rhythm with a stronger poster-style hero and cleaner auth panel.
- Updated the admin shell, status badges, metric cards, and global surfaces so the dashboard feels more cohesive across pages.

## v0.4.0 - 2026-04-11

- Added support for a billing-bypass admin account for testing, so one designated admin can import CSV files without quota enforcement.
- Added automatic startup provisioning for the billing-bypass admin account through environment variables on Railway or other production deployments.
- Documented how to configure free-slot coupons and a debug admin account in production.

## v0.3.0 - 2026-04-11

- Added a dedicated `购买额度 / Buy Quota` page in the admin sidebar for managing listing capacity separately from CSV imports.
- Added coupon support with two paths: Stripe promotion codes for discounts and internal free-quota codes that instantly add bonus vehicle slots.
- Updated CSV import over-limit prompts so they send admins to the quota page instead of starting Stripe from inside the import modal.
- Extended workspace billing to track bonus quota and coupon redemptions in Prisma.

## v0.2.0 - 2026-04-10

- Restored the app back to the correct `TATO / Turo` branding after mixed `Harborline` content was removed.
- Cleaned the main branch so stray listing pages and listing-specific Prisma schema no longer ship with the Turo admin app.
- Kept the Turo core flows in place: vehicle calendar, CSV import, offline orders, owner share links, and Stripe vehicle-slot billing.
- Created a backup branch for the mixed code before cleanup: `codex/backup-harborline-mix-20260410`.

## v0.1.0 - 2026-03-28

- Initial local MVP for the Turo admin backend.
- Added vehicles, owners, orders, calendar, CSV import, and owner share pages.
