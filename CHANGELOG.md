# Changelog

## v0.19.3 - 2026-04-30

- **Calendar control bar visual refresh.** The previous design wrapped action buttons inside a heavy near-black glass pill (`bg-rgba(17,19,24,0.92)`) with semi-transparent white buttons on top — the dark-on-darker-gray result had low contrast and felt detached from the rest of the admin shell, which uses white/cream surfaces with hairline borders and an accent-purple primary action. Three concrete bugs in addition to the visual mismatch:
  - Primary "Create manual order" button used `text-[var(--ink)]` (near-black) on `bg-[var(--accent)]` (#593cfb purple) — dark-on-dark, basically illegible. Now uses `text-white` for proper contrast.
  - Same primary button hover was `hover:bg-[#ff7b67]` — an orange/coral fill that has no relationship to the brand. Replaced with a saturated purple (`#4830d4`).
  - Range-mode segment ("Week / Month / 6 weeks") active state used `text-[var(--ink)]` on `bg-[var(--accent)]` — same dark-on-dark issue. Switched to iOS-style segmented control: white surface track, `bg-[var(--ink)] text-white` selected thumb. Inactive options use `text-[var(--ink-soft)]` with a hover bump.
- **Action row restructured as a flat layout.** Drop the outer dark pill entirely. Prev/next arrow pair gets its own tiny `border + bg-white + p-0.5` container so the relationship still reads as a unit. Today / Create / Download buttons are now standalone chips. Filter selects switched from translucent backgrounds to solid white with the same `var(--line)` border so the bar reads as a single coherent control row instead of three competing islands.
- **Button height `h-11 → h-9` on this surface** (matches the v0.19.1 desktop density target). 36px is still comfortably clickable on a touch device, and on desktop the bar finally feels proportional to the page header above it.
- **`components/vehicle-orders-export-button.tsx` ported to the new chip language** so the trigger button + the export-dialog cancel/confirm buttons match. Three duplicated 100+-character class strings were collapsed into three local constants — would normally extract to a shared `Button` component, but with only this and `calendar-view` using the language so far it's not worth the indirection yet (next time we add a third call site, refactor).

## v0.19.2 - 2026-04-30

- **Hotfix — production server-side exception on every admin page (digest 3150907871).** The v0.19.0 ContactButton was rendered by AppShell (a server component) with `labels={messages.contact}` as a prop. The `messages.contact` block contains four function-valued strings (`filesSelected(count, sizeMb)`, `errorTooManyFiles(max)`, `errorFileTooLarge(filename, mb)`, `errorTotalTooLarge(mb)`) — and Next.js 15 RSC will not serialize functions across the server-to-client boundary, so every render of the admin shell crashed with "a server-side exception has occurred". The crash made the dashboard, calendar, orders, and every other authenticated page un-loadable; users could reach `/login` (it doesn't render AppShell) but landing on `/dashboard` after sign-in immediately failed. `next dev` does not exercise the same RSC streaming path used in production, which is why this slipped through local development and only surfaced after the Railway deploy.
  - Refactored `ContactButton` to take `locale: Locale` (a plain string) instead of the labels object, and to call `getMessages(locale).contact` internally. Same pattern `register-form.tsx` already uses. Functions stay client-side, only a plain string crosses the boundary. AppShell updated accordingly.
  - Added a paragraph to the `ContactButton` JSDoc spelling out the RSC contract so the next person doesn't reintroduce this.

## v0.19.1 - 2026-04-30

- **Desktop density pass.** Top-of-funnel feedback was that the desktop layout left too much air on the page — large titles, generous padding, and decorative kicker badges. Reduced empty space across every admin surface without removing any actual information. Mobile is unchanged (we just did a deliberate looser-on-mobile pass two releases ago); these are pure desktop-breakpoint adjustments.
  - **Sidebar nav font bumped from 13px to 15px**, padding tightened by ~1px each side. Group label tracking nudged from 0.32em to 0.3em so the wider labels still fit. Brand title shrunk from 2.15rem to 1.85rem so it stops dominating the column visually now that nav rows are larger. Aside padding `px-5 py-6 → px-4 py-5`. Net effect: navigation reads as the primary block, not the brand block, and every label is comfortably tap- and click-targetable.
  - **Page-header card** (the "Operations workspace · TATO admin MVP …" badge that wraps every admin page): title down from 2.35rem to 1.6rem on desktop, padding `py-5 → py-3.5`, gap between rows `gap-3 → gap-2`, header bottom margin `mb-5 → mb-3.5`, and the description sized to `12.5px / leading-snug` so it stays readable but stops pretending to be a hero subtitle. ~50% less vertical space, no information removed.
  - **Calendar top control bar** restructured. The `p-4` outer padding plus a 2.2rem center range title plus a separate filters row plus a separate scrubber block was eating ~250px before the timeline could even start rendering. Reframed:
    - Outer padding `p-4 → p-3`, inter-row gap `gap-4 → gap-2.5`.
    - The huge centered range title (`Apr 1 – Apr 30, 2026`) dropped from a standalone block into the scrubber row at 1.05rem next to a small `summary` line — the range buttons + the scrubber thumb already convey that information.
    - Decorative `legend` and `scrollHint` badges removed (the timeline itself signals what blue/green/red mean; horizontal scrolling is obvious as soon as you touch the trackpad).
    - Range-mode pill (`Week / Month / 6 weeks`) moved into the same row as actions + filters so the bar is one row on `xl:` instead of three.
    - Scrubber input slimmed: `mt-3 → mt-2`, track `h-2 → h-1.5`, thumb `h-6 w-6 → h-5 w-5`, scrubber container `px-4 py-3 → px-3 py-2`. Still plenty of grab area, just stops looking like its own UI.
  - **Page list pages** (Dashboard / Orders / Vehicles / Owners) tightened: `space-y-6 → space-y-4 lg:space-y-3.5`, list card padding `sm:p-6 → sm:p-5` or `sm:p-4 lg:p-5`, title fonts dropped one tier on desktop (e.g. vehicle / owner card titles `text-3xl → text-2xl lg:text-[1.4rem]`). Same content, denser presentation.

## v0.19.0 - 2026-04-30

- **Floating in-app feedback button.** Added a "Contact" button at the bottom-left of every admin page (above the BottomTabBar on mobile, above the version chip on desktop). Tapping it opens a feedback modal — bottom sheet on phones, centered card on desktop — where the user can write a message and attach up to 5 files (images / video / PDF, ≤10 MB each, ≤25 MB total). On submit the message arrives in the operator's inbox via Resend with the original files as email attachments and the user's account email as `Reply-To`, so the operator can reply once and start a real conversation. The modal also captures lightweight triage context (page URL, locale, app version, user agent, workspace ID) and renders it as a footer table in the email body so "what page were you on?" is answered in the same message.
  - New `FEEDBACK_RECIPIENT_EMAIL` env var. Leave empty to hide the feature gracefully — the API returns `503 FEEDBACK_NOT_CONFIGURED` and the UI surfaces a localized "feedback isn't set up yet" message instead of failing silently. Documented in `.env.example`, `.env.production.example`, `.env.railway.example`.
  - Reuses the existing Resend HTTPS path (`SMTP_PASSWORD` / `RESEND_API_KEY` + `SMTP_FROM` / `RESEND_FROM`); no new mail provider needed. The `sendMail` core in `lib/email.ts` was extended to support `attachments` + `replyTo` + per-call `timeoutMs` (feedback uses 60s so a 25 MB upload doesn't time out at 15s like the verification code flow does).
  - Activity log: every successful submission writes a `feedback_submitted` row with attachment count, total bytes, and message length so submissions are auditable without leaking the message body itself.
  - Per-file (10 MB) and total (25 MB) caps enforced on both client and server. File-type whitelist (image/, video/, application/pdf, text/plain) prevents the endpoint from being used as a generic file relay.
  - Bilingual `contact.*` i18n strings (EN + 中文 + auto-繁中).
  - `app/(admin)/layout.tsx` switched from `requireAdminAuth` (cookie-only) to `requireCurrentAdminUser` (cookie + DB lookup) so the floating button can pre-fill the From row with the user's name + email. The dashboard already does the same lookup, so this is no extra work in the common case.

## v0.18.3 - 2026-04-30

- **Phase 2B — Calendar mobile list view.** The 1400-line `CalendarView` is a horizontal-scrolling 2D timeline that earns its keep on a 1280px laptop and breaks down on a 375px phone (you have to swipe both axes to see anything useful). Built a new server-rendered `components/mobile-schedule-list.tsx` that buckets the same orders into **Today / Tomorrow / This week / Later** sections — modeled on iOS Calendar's Day view. Each row is a tappable list cell with vehicle, renter, time range, and status badges. "Today" intentionally includes ongoing trips that started yesterday but haven't returned yet, so a host opening the app at noon sees the renter currently driving their car at the top of the list (which is the whole point of a schedule view). The page now renders the list on mobile (`lg:hidden`) and the timeline on desktop (`hidden lg:block`); both pull from the same orders source, so the two views never disagree. New bilingual `calendar.mobile.*` i18n strings.
- **Phase 2B — Vehicles page mobile pass.** The "Create vehicle" form (12 inputs, was occupying ~60% of mobile first screen) wrapped in `<details>` with the `+ → ×` summary pattern. Each vehicle card got mobile-compact padding (`p-4 → sm:p-6`), title scales `text-xl → sm:text-3xl`, supporting copy drops to `12px / leading-snug`, status pills use `gap-1.5 → sm:gap-2` and tighter padding so they fit beside the title without breaking. Edit `<details>` block also tightened.
- **Phase 2B — Owners page mobile pass.** Same treatment as Vehicles: create form collapsed by default, owner cards mobile-tight (title `text-xl`, copy `12px`, status pill `text-[11px]` with `self-start` so it doesn't fight the title row for vertical alignment).

Phase 2C (next round) will tackle: bottom-sheet–style create/edit forms (replace `<details>` with a slide-up modal for a more iOS feel), pull-to-refresh on data-heavy pages, and long-press / swipe actions on list cells.

## v0.18.2 - 2026-04-30

- **Hotfix — Railway build was failing on type check.** `components/app-shell.tsx` declared `navGroups` inline with no type annotation; because `lib/i18n.ts` uses `as const`, every `messages.shell.nav.*` value is typed as a string literal (`"仪表盘"`, `"Dashboard"`, etc.). TypeScript inferred each group's `items` array as a heterogeneous tuple of literal-typed objects, so `navGroups.flatMap((g) => g.items)` failed to unify the four groups (the four sets of literal labels are mutually incompatible). `next dev` doesn't run a full type-check, which is why the regression slipped through locally — `next build` (Railway's build step) caught it. Annotated `navGroups` with explicit `NavItem` / `NavGroup` types so the labels widen to `string` and flatMap composes cleanly. No runtime change.

## v0.18.1 - 2026-04-30

- **Mobile depth pass — Dashboard.** The five KPI cards used to stack vertically on phones (`md:grid-cols-2` collapsed to one column under 768px), pushing the actual content half a screen down. They now ride in a horizontal snap-scroll strip that bleeds to the screen edge — same pattern Apple Wallet / App Store widget rows use. Each card slot is 58% of viewport so the next one peeks in to signal "swipe me", and `MetricCard` itself picks up tighter mobile padding (`p-4` vs `sm:p-5`) and a smaller value font (`2rem` vs `sm:2.7rem`) so it reads cleanly at half-screen width. Desktop / tablet (`sm:` and up) revert to the original static grid — nothing changes there.
- **Mobile depth pass — Dashboard rows.** Upcoming-orders rows are now tappable `<Link>`s (whole row is a hit target, like an iOS list cell), with tighter `px-4 py-3` mobile padding and truncated titles for narrow screens. Empty states added for both Upcoming and Activity (`upcomingEmpty` / `activityEmpty` strings, EN + 中文 + auto-繁中) so a brand-new workspace doesn't show two empty white cards.
- **Mobile depth pass — Orders create form.** The 12-input "Create offline order" panel was eating ~70% of the orders page on a phone, even though most visits are for browsing existing orders. It's now wrapped in a native `<details>`, collapsed by default, with a styled summary that animates a `+` to `×` on open. No client-side JS needed — `<details>` gives free disclosure, keyboard support, and a11y semantics.
- **Mobile depth pass — Orders cards.** Every order card was rendering its title at `2rem` and using `px-5 py-5` padding, leaving narrow margins on a 375px viewport. Title now scales `1.4rem → 2rem` from mobile to desktop, container padding `p-4 → p-5`, status pill row uses `gap-1.5 → gap-2`, and the data grid drops from `text-sm` to `text-[13px]` on mobile so `Phone / Pickup / Return / Payment / Contract / Created by` fit two-up without truncating.

## v0.18.0 - 2026-04-30

- **App-like mobile shell — phase 1.** Reframed the mobile experience from "responsive sidebar" to "iOS-style app". This is the foundation for the upcoming native client and for adding the site as a home-screen PWA today.
  - New PWA manifest (`app/manifest.ts`, served at `/manifest.webmanifest`). `display: standalone` strips Safari chrome when launched from the home screen so the site feels native; `theme_color: #111318` colors the iOS status bar; `start_url: /dashboard` lands authenticated users on something useful.
  - Dynamic app icons via Next 15 file conventions: `app/icon.tsx` (192/512 PWA icons) and `app/apple-icon.tsx` (180×180 iOS icon). Rendered as `ImageResponse`, so no static asset is needed and the brand stays in sync with the rest of the app.
  - `viewport-fit=cover`, `initialScale=1`, `maximumScale=1`, `userScalable=false`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent` configured via the new Next 15 `viewport` export and `metadata.appleWebApp`. Lets the page draw under the iOS notch / Dynamic Island and behave as a real app once added to the home screen.
  - New `components/bottom-tab-bar.tsx` — iOS-HIG style 5-cell bottom navigation: **Home / Calendar / Orders / Fleet / More**. The first four are the highest-frequency surfaces; the More button opens a bottom-sheet with the remaining seven destinations plus the language switcher, sign-out, and version chip — so the mobile shell exposes everything the desktop sidebar does without a second drawer. Active state is path-based and groups related routes (e.g. `/orders` and `/imports` share the Orders tab; `/vehicles`, `/vehicle-roi`, `/owners` share the Fleet tab). New bilingual `shell.bottomNav.*` i18n strings.
  - `components/mobile-nav.tsx` collapsed to a brand-only sticky top bar — the hamburger drawer was redundant once the bottom tab bar existed. Also picks up `pt-safe` so the bar clears the iOS notch.
  - `components/app-shell.tsx` rewired to render the bottom tab bar on mobile, push `<main>` content up by `calc(env(safe-area-inset-bottom)+88px)` so the last row of any page never hides behind the bar or the iOS home indicator, and pass the full nav + language/logout/version controls into the More sheet.
  - `globals.css` mobile chrome upgrades: `-webkit-tap-highlight-color: transparent` (no more gray flash on tap), `overscroll-behavior-y: none` (kills Safari rubber-band that was exposing white behind sticky bars), 16px input font on `≤640px` (prevents iOS auto-zoom on focus), `.pt-safe` / `.pb-safe` / `.pl-safe` / `.pr-safe` utilities, and a `.tap-press` class with `transform: scale(0.96)` on `:active` scoped to `(hover: none)` for tactile feedback on touch.
  - The floating version chip is now `lg:` only — on mobile it would have collided with the tab bar.

To finish the App-like overhaul, the next phases will deep-clean the highest-frequency pages (dashboard / calendar / orders) into card-first mobile layouts, add list-item swipe actions, and introduce pull-to-refresh on data-heavy pages. The shell pieces in this release are deliberately page-agnostic so those phases can land iteratively without re-doing the chrome.

## v0.17.0 - 2026-04-30

- **UI fix — accent borders/shadows reappear across the admin shell.** Tailwind's arbitrary-value brackets (`border-[...]`, `shadow-[...]`, `bg-[...]`) reject literal whitespace, so every `rgba(89, 60, 251, X)` and `rgba(247, 247, 247, X)` etc. with comma-space formatting was being silently dropped — Tailwind split the class on the spaces and never generated the rule. ~38 occurrences across `app/(admin)/*`, `components/calendar-view.tsx`, `components/public-booking-panel.tsx`, `components/status-badge.tsx`, `components/vehicle-orders-export-button.tsx`, `app/share/[token]/page.tsx`, `app/reserve/[vehicleId]/page.tsx`, and `app/layout.tsx` were rewritten to use the comma-only form. The accent purple borders, button glow shadows, and panel gradients all become visible again. No design change — this is what the markup intended all along.
- **Bug fix — direct booking orders are no longer workspace-orphaned.** When a renter completed a `/reserve/[vehicleId]` checkout, the Stripe `checkout.session.completed` webhook (`lib/direct-booking-server.ts`) created the resulting Order without setting `workspaceId`. Every admin surface (calendar, dashboard, orders, share pages) filters by `workspaceId`, so the host had been paid but the booking was invisible — the row sat in the DB with `workspaceId: NULL`. The webhook now reads `vehicle.workspaceId` and writes it onto the new Order. As a guardrail, if a vehicle ever lacks a workspace, the webhook refunds the renter and logs `direct_booking_workspace_missing` instead of silently creating an orphaned order.
- **New — forgot-password / reset-password flow.** Two-step path mirroring registration: visit `/forgot-password`, receive a 6-digit code by email, then enter it together with a new password. The flow reuses the existing `EmailVerification` table via a new `purpose: "password_reset"` value, so no new DB primitive is needed. The email send goes through the same Resend HTTPS path as registration (with the dev-mode fallback that logs the code to the server console). To prevent the form from being used as an email-existence oracle, step 1 always reports success when the input is well-formed; the actual email is only sent when the account exists. Step 2 verifies, writes a fresh bcrypt hash (min 8 chars), wipes the `login_email` rate-limit bucket, and logs a `password_reset` activity entry. Bilingual copy added (`forgotPassword.*` keys in EN + 中文 + auto-converted 繁中). The login page picks up a new "Forgot your password?" link.
- **New — brute-force protection on login & share-link unlock.** Added a generic `RateLimitAttempt` model (one row per `scope+identifier`) and a `lib/rate-limit.ts` primitive (`checkRateLimit` / `recordFailedAttempt` / `resetAttempts` / `getClientIp`). `loginAction` now buckets failures by both email (5 / 15 min) and IP (10 / 15 min); `unlockShareLinkAction` buckets by share token (6 / 15 min) and IP (24 / 15 min). The locked branch redirects with `?error=throttled` so the UI shows a dedicated "Too many failed attempts" message instead of generic "Invalid credentials". Successful sign-in or unlock wipes the bucket so a few earlier typos don't count later. The check runs before bcrypt to keep the lockout from being used as a CPU-DoS vector.
- **Schema** — adds `RateLimitAttempt` to `prisma/schema.prisma` with a unique `(scope, identifier)` index. Run `npm run db:push` (or `prisma migrate dev`) on each environment to materialize the table. No migration of existing data is needed — the table starts empty.

## v0.16.5 - 2026-04-28

- Fixed multiple admin pages that horizontally overflowed the mobile viewport (~375px). Audited every admin page + the panel components rendered inside, identifying real overflow culprits (not just "could be nicer"):
  - `/imports`: the import-log table had `overflow-hidden` on its scroll container, hiding columns 3-5 entirely on mobile. Switched to `overflow-x-auto` so users can swipe horizontally to read the rest. Also collapsed the section header (`flex items-center justify-between`) to `flex flex-col sm:flex-row` so the "sample file" hint stops fighting the title for width.
  - `/share-links`: the long share-link UUID and `/share/<token>` URL rendered without `break-all` and pushed each card past the viewport edge. Added `break-all` to those `<p>` tags. Also reduced the owner-name `<h3>` from `text-3xl` to `text-2xl sm:text-3xl` so the article header doesn't dominate small screens.
  - `/direct-booking`: the rate / insurance / deposit input row was a hard-coded `grid-cols-3` (always 3 cols, no mobile fallback). Each input collapsed to ~104px wide at 375px — labels and number inputs blew out. Switched to `grid-cols-1 sm:grid-cols-3` so the three pricing fields stack on phones.
  - `/dashboard`: the "Upcoming schedule" header (`flex items-center justify-between` with title + "Open orders" link) overflowed on long Chinese titles. Collapsed to `flex flex-col sm:flex-row` and reduced the heading to `text-2xl sm:text-3xl`. Reduced section padding from `p-6` to `p-4 sm:p-6` so the 24px-each-side padding doesn't eat half the viewport on a phone.
  - `/payouts`: every section card used `px-8 py-7` / `px-8 py-6` (32px horizontal padding), which on a 375px viewport with the admin shell's `px-3` left only ~287px for content — too tight for the long Stripe account ID. Switched to `px-5 py-5 sm:px-8 sm:py-6` (and `px-5 py-6 sm:px-8 sm:py-7` for the page header) so card content gets ~40px more breathing room on phones.
- Verified `/calendar` is intentionally horizontally scrollable inside its `overflow-auto` container (the timeline grid is naturally wider than a phone — that's expected behavior, swipe to scrub). The CSV-import preview table is the same: already wrapped in `overflow-x-auto`. No change needed for those.

## v0.16.4 - 2026-04-28

- Switched the verification-email sender from SMTP (nodemailer → `smtp.resend.com:587`) to Resend's HTTPS API (`POST https://api.resend.com/emails`). Diagnosed via Railway deploy logs showing `[email] send failed :: reason=Connection timeout` paired with an empty Resend dashboard log — i.e. the SMTP TCP session never reached Resend. Railway egress to outbound port 587 isn't reliable in every region, while HTTPS:443 is unblocked everywhere and is Resend's officially recommended path. Registration no longer hangs.
- Reused existing env vars to keep the Railway config unchanged: `SMTP_PASSWORD` (the `re_…` Resend API key) is read as the bearer token, `SMTP_FROM` is read as the sender address. New `RESEND_API_KEY` and `RESEND_FROM` env vars are also accepted and take priority if set, so the deployment can migrate to clearer names later. `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` are now unused but harmless.
- Kept the 15-second hard-cap on the send via `AbortController`, so a stuck request fails the registration in 15s with `reason=timeout_15s` instead of leaving the user staring at "Sending verification code…". Resend API errors surface as `reason=resend_<status>` with the response body excerpt logged for diagnosis.

## v0.16.3 - 2026-04-28

- Cut the email-send hang from 2 minutes to ~10 seconds when SMTP misbehaves. Added `connectionTimeout: 10s`, `greetingTimeout: 10s`, `socketTimeout: 15s` to the nodemailer transporter so a misconfigured / unreachable SMTP server returns an inline error instead of leaving the registration form stuck on "Sending verification code…" forever.
- Added explicit `console.log` / `console.error` lines in the email sender so successful sends record `to / messageId / response` and failed sends record `to / host / from / reason` in Railway logs. Makes diagnosing "user said the code never arrived" quick from the deploy log + Resend dashboard logs combined.

## v0.16.2 - 2026-04-28

- Added a third UI language: Traditional Chinese (`zh-Hant`). The locale type now accepts `en | zh | zh-Hant`; both the cookie store and the `Accept-Language` browser fallback recognize Taiwan / Hong Kong / Macau / `zh-Hant` preferences. `getLocale()`, `resolveLocale()`, `getLocaleTag()` updated accordingly.
- Built `lib/sc-to-tc.ts`, a per-character Simplified-to-Traditional substitution map covering ~250 chars present in our `i18n.ts` admin strings. Traditional Chinese messages are computed from the existing `zh` block at module load via `convertMessagesScToTc`, so we keep one source of truth and the converter preserves message-getter functions (e.g. `quoteDays(count)`).
- The sidebar `LanguageSwitcher` now exposes four buttons (Auto / EN / 中文 / 繁中) with the layout adjusted to a 4-column grid. Login and registration pages get a new `CompactLanguageSwitcher` (3-button pill, no `Auto`) anchored to the top-right.
- Redesigned `/login` and `/register` to a pure black-and-white palette — the dark hero column is now solid `#000` with no orange/green tints, the form column is `#fff`, all accent colors and `var(--accent)` underlines on these two pages are replaced with plain black. Buttons, borders, and focus states use `bg-black` / `border-black` only.
- Made `/login`, `/register`, and the entire admin shell mobile-responsive. The login/register two-column layout collapses to a single full-width form on small screens, with a mobile brand header on top. The admin shell ships a new `MobileNav` component (sticky top bar with brand + hamburger; slide-in drawer with the full sidebar; backdrop closes on tap; auto-closes on route change). The page header card also stacks vertically and shrinks the title size on small screens so long titles don't blow out the viewport.
- Updated `components/public-booking-panel.tsx`, `app/(admin)/orders/page.tsx`, and `app/(admin)/vehicle-roi/page.tsx` to accept the new `Locale` union (previously hard-coded to `"en" | "zh"`) so Traditional Chinese visitors don't trip TypeScript errors on date/weekday formatting.

## v0.16.1 - 2026-04-28

- Surfaced the new-account welcome promo code on the billing page. A small accent-tinted card under the coupon copy now reads `New account bonus · Brand new accounts can redeem the code 3MONTHFREE for 3 months free of paid vehicle slots — limit one redemption per account.` (English + 中文 ready). The existing coupon-input flow already handles Stripe promotion codes, so once `3MONTHFREE` is provisioned in the Stripe dashboard the redemption path works end-to-end with no extra code.
- To activate the promo end-to-end on Stripe:
  1. Stripe Dashboard → Products → Coupons → New coupon: `100% off`, `Duration: repeating`, `Duration in months: 3`.
  2. Stripe Dashboard → Promotion codes → New: code `3MONTHFREE`, attach the coupon above, set `Max redemptions per customer = 1` so each new account can only redeem once.
  3. Done — the existing `/billing` coupon input now resolves `3MONTHFREE` via `lib/billing.ts`'s `resolveBillingCoupon` and feeds it into Stripe Checkout via `discounts: [{ promotion_code: ... }]`.

## v0.16.0 - 2026-04-28

- New email verification step on sign-up. The `/register` page is now a two-step flow: enter name/email/password → receive a 6-digit code by email → enter the code to actually create the account. The User row, Workspace, and WorkspaceBilling are only created after the code matches, so unverified emails never produce live admin accounts.
- Added an `EmailVerification` model storing per-attempt records (email, bcrypt-hashed code, purpose, expiresAt, attempts, consumedAt). Codes expire after 10 minutes and lock out after 5 failed attempts; resends are throttled to one per 30 seconds per email.
- Added `lib/email.ts` with a nodemailer wrapper. Reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` env vars to send the verification email (Gmail SMTP, AWS SES, Postmark, Mailtrap — anything with SMTP works). When SMTP is not configured the wrapper logs the verification code to the server console so local dev still works without an email service. Both English and 中文 templates ship.
- Added `lib/email-verification.ts` with `issueRegistrationCode` / `verifyRegistrationCode` / `purgeStaleVerificationCodes` helpers, plus rich error reasons (`throttled`, `expired`, `invalid_code`, `too_many_attempts`, `no_pending_code`) surfaced inline in the registration UI.
- Replaced the old single-shot `registerAction` with `requestRegistrationCodeAction` (step 1) and `verifyAndRegisterAction` (step 2), both returning typed result objects so the new client-side `RegisterForm` can render inline error / success feedback without round-tripping through query params.
- Bilingual i18n strings added for every step of the new flow (verify step copy, code label, resend, back-to-details, smtp-fallback notice, all five error reasons).

## v0.15.5 - 2026-04-28

- Added an `Order.isArchived` flag so CSV imports hide cancelled or stale Turo rows without physically deleting their database records or original CSV metadata.
- Changed the CSV import sync to archive cancelled rows and stale Turo orders instead of calling `delete` / `deleteMany`; active rows are unarchived again if they reappear in a later CSV.
- Filtered archived orders out of operational surfaces including calendar, orders, dashboard, ROI, direct booking, owner share pages, and vehicle-order exports.
- Tightened older API routes for offline order edits and order notes so they operate only inside the current workspace, reducing cross-workspace data isolation risk.
- Added production guards to the destructive seed and database reset scripts so they refuse to run on Railway or with `NODE_ENV=production`.

## v0.15.4 - 2026-04-28

- Reorganized the sidebar navigation into four labelled groups instead of a flat 11-item list, since the menu got noticeably crowded after Stripe Connect / Payouts landed:
  - **Operations / 运营**: Dashboard, Calendar, Orders, CSV Imports
  - **Fleet / 车队**: Vehicles, Vehicle ROI, Owners
  - **Customer Booking / 客户接入**: Direct Booking, Share Links
  - **Billing / 账务**: Buy Quota, Payouts
- Group headings render as small uppercase tracker labels above each cluster; item rows kept their pill style but with slightly tighter vertical padding so the grouped sidebar fits in roughly the same vertical space.
- Bilingual i18n keys added for the four group labels (`groupOperations`, `groupFleet`, `groupBookings`, `groupBilling`).

## v0.15.3 - 2026-04-28

- Wired Stripe Connect onboarding all the way through to renter payments. The direct-booking checkout route now creates a Destination Charge with `transfer_data.destination` set to the host's Connect account, `on_behalf_of` set to the same account so the renter's card statement shows the host's business name, and a 5% `application_fee_amount` carved out of the rental + insurance subtotal (deposit excluded — it's a refundable hold, not earned revenue).
- The public `/reserve/[vehicleId]` page and `PublicBookingPanel` now gate on the host's Connect account being charges-enabled. If the host hasn't finished payouts onboarding yet, the renter sees `车主尚未开通收款账户 / The host hasn't set up payouts yet` and the checkout button is disabled.
- Added an `account.updated` Stripe webhook handler. When a host completes (or progresses through) Stripe Express onboarding, charges/payouts/details-submitted flags sync into `WorkspaceBilling` automatically — no need for the host to click `Refresh status` on the Payouts page.
- Added bilingual copy (`hostPayoutsMissing`, `hostPayoutsHint`) and a new helper `getWorkspaceConnectSnapshotByVehicleId` for booking flows that start from a vehicle id.

## v0.15.2 - 2026-04-22

- Slimmed the calendar row height while keeping the larger order bar size from v0.15.1. Lane spacing dropped from 36px to 32px, single-lane rows from 64px to 44px, so the calendar fits noticeably more vehicles on screen without sacrificing the easier-to-click order bar.
- Compacted the left vehicle column from three lines (plate / model / owner) to two: plate on top, model + owner combined on the second line with a separator and truncate. Padding tightened (`py-3 → py-1.5`) and content uses `leading-tight` so it stays inside the new 44px row minimum without overflowing.

## v0.15.1 - 2026-04-22

- Made calendar order bars taller and easier to click. Lane height bumped from 28 to 36 and bar height from 20 to 28; the bar text also moved from `text-xs` to `text-[13px]` with thicker borders, and the row min-height grew so multi-lane rows do not feel cramped.
- Added a horizontal date scrubber on top of the calendar timeline. Drag the slider to jump the focus date anywhere from one year in the past to one year in the future without clicking the previous/next arrows; tick labels mark today plus ±6 months and ±12 months. Bilingual copy added (`滑动跳转日期 / Scroll to a date`).

## v0.15.0 - 2026-04-22

- First slice of the per-workspace payouts feature. Each workspace can now connect its own Stripe Express account from a new `/收款账户 / Payouts` page; the onboarding link opens Stripe's hosted verification flow and the page shows charges-enabled / payouts-enabled status plus the account country.
- Added Connect-related columns to `WorkspaceBilling` (`stripeConnectAccountId`, `stripeConnectCountry`, `stripeConnectChargesEnabled`, `stripeConnectPayoutsEnabled`, `stripeConnectDetailsSubmitted`, `stripeConnectOnboardedAt`). All fields are nullable or defaulted so `prisma db push` does not require `--accept-data-loss`.
- Added `lib/stripe-connect.ts` with helpers for creating Express accounts (Canada and United States), issuing onboarding links, opening the Express dashboard via login links, and refreshing the account snapshot from Stripe.
- Added server actions (`lib/payouts-actions.ts`) and a client panel (`components/payouts-panel.tsx`) plus bilingual copy (EN + 中文) so each host sees a clear onboarding flow and can resume it if Stripe requires more info.
- Sidebar entry `收款账户 / Payouts` added after `购买额度 / Buy Quota`.
- Platform fee is 5% per booking (applied in an upcoming slice that wires the renter checkout to Destination Charges with `on_behalf_of`, so the renter's card statement will show the host's business name).

## v0.14.12 - 2026-04-22

- When CSV import tries to create a vehicle whose plate already exists in another workspace (almost always the `default` workspace that owned data imported before the user registered into their own workspace), adopt that vehicle into the current workspace instead of failing the row with `Duplicate plateNumber value (unique constraint)`. Moves the vehicle's historical orders along with it so `findExistingImportedOrder` keeps deduplicating correctly.
- The adopted vehicle's notes record "Adopted from another workspace during Turo CSV import." so the origin of the change is visible in the vehicle edit UI.

## v0.14.11 - 2026-04-21

- Stopped rewriting `Vehicle.plateNumber` during per-row CSV sync. Plates are stable identifiers; overwriting them on every matched row tripped the global `plateNumber` unique constraint and surfaced as `Invalid prisma.vehicle.update() invocation: Unique constraint failed on the fields: (plateNumber)`, which killed the entire batch. Users can still edit the plate from the vehicle management screen when it genuinely needs to change.
- Wrapped every CSV import row in try/catch so a single unexpected Prisma error (unique violation, FK violation, etc.) becomes one entry in the per-row failure breakdown instead of taking down the whole import. Added a `summarizeImportError` helper that turns verbose Prisma error envelopes into readable `Duplicate X value (unique constraint)` / `Foreign key violation on X` labels in the aggregated panel.

## v0.14.10 - 2026-04-21

- Reverted the `Vehicle.plateNumber` schema change from v0.14.9 back to a global `@unique` column. The composite `@@unique([workspaceId, plateNumber])` made Prisma `db push` on Railway refuse to sync without `--accept-data-loss`, crash-looping production; the real CSV-import fix lives in the application-layer plate extraction and workspace-scoped `findFirst`, which still work with a global-unique plate column.
- Deferring the composite-unique rework until it can ship as a proper migration so we do not need to toggle `--accept-data-loss` on the deploy entrypoint.

## v0.14.9 - 2026-04-21

- Fixed a silent CSV import failure where rows whose Turo "Vehicle" column started with a year (e.g. `2022 Tesla Model Y`) collapsed every year-matching car into one vehicle row, so most trip rows appeared as `Vehicle not found` failures. `extractPlateNumber` now skips pure-digit tokens and prefers real plate-shaped tokens, parenthesised plates, the Turo vehicle id, or the VIN tail.
- Scoped `Vehicle.plateNumber` uniqueness to the owning workspace so two workspaces can keep the same plate, and so auto-creating vehicles during a CSV import no longer silently returns null when a plate was already taken by another workspace or a prior failed import.
- Expanded the list of accepted CSV date formats to include `M/d/yyyy h:mm a`, ISO `T`-separated timestamps, and month-name formats like `Apr 22, 2026 9:00 AM`, eliminating the `Invalid pickup or return date` failures that Turo earnings exports with single-digit day/month/hour produced.
- Widened the auto field-mapping heuristic to recognize `Reservation`, `Listing`, `Nickname`, `Driver`, `Confirmation code`, `Start`/`End`, `Payout`, and other common Turo and generic column labels so more imports succeed without manual dropdown editing.
- Surfaced an aggregated failure breakdown (reason · count · sample row numbers) directly in the import panel after a run so you can tell exactly which rows were rejected for which reason instead of only seeing `N 失败`.

## v0.14.8 - 2026-04-21

- Added a `reusable` marker to the `BILLING_FREE_SLOT_COUPONS` env var so free-quota coupon codes can be redeemed by every workspace (and re-applied within the same workspace) without tripping the one-shot global uniqueness guard.
- Updated coupon redemption for reusable codes to lift the workspace bonus to the coupon's minimum instead of stacking on each apply, preventing quota inflation from spamming the apply button.
- To turn `LKF9888` into an unlimited-use unlock, set `BILLING_FREE_SLOT_COUPONS=LKF9888:999999:Unlimited listings:reusable` on Railway and redeploy.

## v0.14.7 - 2026-04-18

- Stopped re-running the server-side billing projection every time the selected-vehicle checkboxes change in the CSV quota modal.
- Moved the selected-vehicle projection math to the client, so large CSV files no longer sit on `正在检查这份 CSV...` while you are only choosing which vehicles to import within quota.

## v0.14.6 - 2026-04-18

- Replaced the CSV import page loading states with explicit client flags instead of `useTransition`, fixing the bug where imports could finish and show a result while the button stayed stuck on `导入中 / Importing`.
- Applied the same explicit-state pattern to the quota re-check, so the selected-vehicle import modal now unlocks and relocks predictably during CSV quota validation.

## v0.14.5 - 2026-04-18

- Fixed the quota modal so `导入已选车辆 / Import selected vehicles` stays clickable after choosing vehicles, instead of being disabled by the background billing re-check that runs after each checkbox change.
- Kept the real quota validation on the server, so the smoother modal interaction does not reduce billing-limit safety.

## v0.14.4 - 2026-04-18

- Added Stripe billing config validation so `STRIPE_LISTING_PRICE_ID` must be a real Stripe Price ID (`price_...`) instead of a Product ID (`prod_...`).
- Changed the billing page to treat an invalid Stripe price configuration as “not configured”, preventing a raw Stripe API error from surfacing when the wrong ID is pasted into Railway.

## v0.14.3 - 2026-04-18

- Redesigned the CSV import workspace so the flow reads top-to-bottom as four numbered steps (download, check quota, upload + map, run) with a dedicated how-to strip at the top of the page.
- Collapsed the previous two-column layout into a compact main column for the upload, mapping and import actions plus a tighter right-rail quota card, eliminating the confusing 0/1/2/3 ordering that mixed billing and upload steps side-by-side.
- Dimmed the mapping and import cards until a file is uploaded, moved the field-mapping dropdowns into a 2-column grid, and replaced the oversized card titles and padding with tighter type so the whole page fits without scrolling on standard screens.

## v0.14.2 - 2026-04-18

- Ranked the Vehicle ROI cards by `每公里净收益` (net revenue per kilometre) from highest to lowest, with vehicles missing distance data falling to the bottom, and added a visible `#N` rank badge to each card.
- Rebuilt the ROI card layout as a single-column stack so each vehicle block gets the full width, eliminating the cramped side-by-side rendering where currency strings were overlapping on standard monitors.
- Fixed text overlap inside the monthly-revenue breakdown by switching the six-month grid to a label-left / value-right stacked row, tightening the headline sizes, and applying `tabular-nums` so currency figures align cleanly.

## v0.14.1 - 2026-04-18

- Fixed a production boot crash where `prisma/bootstrap-admins.ts` and `prisma/bootstrap-workspaces.ts` could not resolve the `server-only` module under `tsx`, causing Railway containers to exit on every start and healthchecks to fail.
- Dropped the `server-only` directive from `lib/workspaces.ts` since the file is only pulled in from server contexts (Next server components, server actions, and the deploy-time bootstrap scripts).

## v0.14.0 - 2026-04-18

- Redesigned the entire app visual language to feel closer to Turo: white/gray surfaces instead of warm ivory, Turo-purple `#593cfb` accent replacing coral, and tighter corner radii across admin and renter-facing pages.
- Replaced the Arial 13px body type with an Inter-first stack at 14px for a more direct, modern reading experience and dropped the decorative orange/green radial gradients from the page background.
- Swept hardcoded warm color literals and oversized `rounded-[2rem]`/`rounded-3xl` pill shapes out of cards, modals, login/register hero panels, FullCalendar toolbars, and the direct-booking surfaces so the whole admin reads as one cohesive gray/white system.
- Introduced workspace multi-tenancy: new `Workspace` model plus nullable `workspaceId` foreign keys on users, owners, vehicles, orders, import batches, share links, and activity logs, with `requireCurrentWorkspace` gating all workspace-scoped admin queries.
- Added a `bootstrap-workspaces` deploy step that backfills pre-existing rows into a shared default workspace so live data keeps showing up for current admins after the schema rollout.

## v0.13.2 - 2026-04-18

- Added a Railway production startup guard that refuses to boot if no persistent volume is attached, if the volume is mounted anywhere other than `/app/data`, or if `DATABASE_URL` points outside the mounted volume.
- Prevented silent fallbacks to a fresh empty SQLite file on redeploys, so misconfigured Railway deploys now fail loudly instead of appearing to wipe vehicle and order data.

## v0.13.1 - 2026-04-18

- Fixed the quota-selection import flow so `Import selected vehicles` no longer immediately reopens the quota modal after a valid subset has been chosen.
- Disabled the modal import action while the billing re-check is still running, preventing stale quota state from retriggering the popup.
- Closed the quota modal automatically after a successful CSV import and reset it when a new CSV file is chosen.

## v0.13.0 - 2026-04-18

- Fixed a critical gap where Stripe direct-booking payments completed but were never written to the Order table; the webhook now persists paid bookings idempotently and auto-refunds late-detected conflicts.
- Required `SESSION_SECRET` in production and rejected the insecure development fallback so admin cookies can no longer be forged on misconfigured deploys.
- Hardened CSV date parsing to accept 12h/24h/slash formats and interpret wall-clock times in a configurable `CSV_IMPORT_TIMEZONE` (default `America/Vancouver`), eliminating silent timezone drift on UTC servers.
- Expanded middleware protection to `/billing`, `/direct-booking`, and `/vehicle-roi`, and bound share-link access cookies to the current password hash so rotating the password revokes previously unlocked sessions.
- Redesigned the direct-booking admin card into a denser single-column layout: price inputs now span the full card width instead of getting squeezed into a narrow side column.

## v0.12.0 - 2026-04-17

- Replaced the renter-facing direct-booking date inputs with a custom calendar picker that disables occupied dates before the renter can choose them.
- Added client-side range blocking so pickup and return dates can no longer be selected if they would overlap an existing booking window.
- Kept the server-side checkout conflict guard in place, so both the UI and Stripe checkout now protect against overlapping reservations.

## v0.11.1 - 2026-04-17

- Hardened production startup so deploys no longer run Prisma with `--accept-data-loss`, preventing version updates from silently wiping live vehicle and order data.
- Added an automatic SQLite backup step before production schema sync, making Railway redeploys safer when a persisted volume is attached.
- Updated deployment guidance to clarify that production deploys now preserve data and will fail safely instead of applying destructive schema changes.

## v0.11.0 - 2026-04-17

- Added a per-vehicle direct-booking deposit field so admins can charge a fixed security deposit together with rental price and insurance.
- Updated the public reservation quote and Stripe checkout flow so renters now pay `rental + insurance + deposit`.
- Exposed the new deposit amount on both the admin booking setup page and the renter-facing booking page.

## v0.10.1 - 2026-04-17

- Fixed direct-booking preview links to use the current live request domain instead of a stale or placeholder app URL, preventing `Open booking page` from landing on Railway's `Not Found` placeholder.

## v0.10.0 - 2026-04-17

- Added a quota-aware CSV import selection flow so admins can choose which new vehicles from an over-limit CSV should be imported within the currently available quota.
- Updated billing import checks to return the detected new-vehicle list, remaining available vehicle slots, and the projected fleet size based on the chosen subset.
- Scoped stale Turo-order replacement to only the vehicles included in the current import, preventing partial vehicle imports from wiping unrelated vehicle history.

## v0.9.1 - 2026-04-17

- Fixed direct-booking action buttons rendering as dark pills without visible labels by correcting the global CSS layer ordering and explicitly setting button text color on the new booking surfaces.

## v0.9.0 - 2026-04-17

- Added a new `在线预定 / Direct Booking` admin workspace for configuring vehicle-level public booking pages, share links, daily pricing, and insurance fees.
- Added a renter-facing public reservation page per vehicle at `/reserve/[vehicleId]` with a first-pass quote builder, blocked-date visibility, and a Stripe-ready checkout entry.
- Added persisted direct-booking vehicle settings in Prisma so each imported vehicle can be toggled on for public booking independently.

## v0.8.0 - 2026-04-12

- Added a new `车辆投资回报分析 / Vehicle ROI` workspace in the left navigation so admins can review return metrics per vehicle.
- Added vehicle ROI calculations based on imported order history: monthly earnings, net earnings per kilometre from CSV distance data, and annualized return based on manually entered purchase price.
- Added persistent `purchasePrice` support for vehicles, including inline save controls on the ROI page and purchase price inputs on the vehicle management page.

## v0.7.0 - 2026-04-12

- Restyled the orders page to match the newer Turo-inspired design system with warmer surfaces, stronger typography, and cleaner spacing.
- Rebuilt the offline-order creation form, booking search block, and order cards so the page feels more like one operations workspace instead of stacked utility cards.
- Added bilingual section titles and supporting copy for the refreshed orders workspace while preserving the existing search, update, delete, and edit flows.

## v0.6.0 - 2026-04-12

- Reworked the calendar page to feel closer to a Turo-style control room with a stronger toolbar, warmer filters, and a tighter timeline surface.
- Restyled the vehicle timeline table with softer ivory surfaces, clearer weekday headers, alternating row treatment, and more deliberate booking bars.
- Upgraded the booking inspector, manual-order modal, export modal, and owner share calendar header so the calendar flow now reads as one cohesive operating interface.

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
