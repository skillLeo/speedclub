# 06 — Super-Admin Portal ("God Mode") Specification

**Goal:** the client can run and change the entire platform without a developer — members, content, catalogue, moderation, branding, configuration, staff — with **maximum record** (every action audited) and **safeguards** (MFA, re-auth, four-eyes, least privilege). Route list: `04_SCREEN_REGISTER.md` §5. Design: `03_DESIGN_SYSTEM.md` §14.

## 1. Principles
1. **God mode = everything is possible, nothing is silent.** Every state change and every view of sensitive data writes an audit event with actor, target, before/after and reason.
2. **Staff never see or set member passwords.** They can send a reset link, force a password change at next login, revoke sessions, reset 2FA (four-eyes). Temporary passwords are not offered (GDPR/security).
3. **Least privilege:** roles are bundles of permission atoms; the UI hides what a role cannot do, the server enforces it.
4. **High-risk = four-eyes:** a second staff member approves.
5. **Runtime changes are versioned:** branding, content, flags and remote config follow draft → preview → publish (reason) → rollback.

## 2. Roles & permission atoms (guard `staff`, spatie/laravel-permission)
**Atoms:** `members.view` · `members.view_pii` · `members.edit` · `members.restrict` · `members.suspend` · `members.delete`* · `members.reset_password` · `members.revoke_sessions` · `members.reset_2fa`* · `members.view_as` · `members.export`* · `members.message_metadata` · `vehicles.view` · `vehicles.edit` · `vehicles.hide` · `vehicles.delete` · `media.review` · `media.hide` · `catalog.view` · `catalog.manage` · `catalog.import` · `qr.view` · `qr.revoke` · `moderation.view` · `moderation.decide` · `moderation.appeals` · `moderation.messages` · `moderation.rules` · `moderation.templates` · `support.view` · `support.reply` · `support.macros` · `content.view` · `content.edit` · `content.publish` · `brand.manage` · `legal.publish` · `flags.manage` · `remote_config.manage` · `maintenance.toggle`* · `releases.manage` · `staff.view` · `staff.invite` · `staff.manage` · `roles.manage`* · `approvals.decide` · `audit.view` · `audit.export`* · `privacy.view` · `privacy.process` · `retention.manage` · `system.view` · `system.jobs` · `integrations.view` · `analytics.view` · `memberships.manage` (flagged). (* = always four-eyes)

| Role | Summary |
|---|---|
| **Owner** | Everything, including roles and org settings. At least one, max 3. Cannot be deleted by anyone but another Owner (four-eyes). |
| **Admin** | Everything except managing Owners and org legal identity. |
| **Moderator** | moderation.*, media.review/hide, vehicles.view/hide, members.view, members.restrict, members.suspend (time-limited ≤ 30 days), qr.view, support.view. No PII beyond what a case needs. |
| **Support** | members.view + view_pii, reset_password, revoke_sessions, view_as (with member consent), support.*, privacy.view, vehicles.view, qr.view. |
| **Content editor** | content.view/edit/publish, brand.manage, catalog.view/manage/import, qr.view. Legal documents only as drafts. |
| **Analyst** | Read-only: analytics.view, members.view (no PII), vehicles.view, qr.view, moderation.view (no message content). No exports. |

**Four-eyes list:** delete member · reset member 2FA · member/PII export · role change that grants Admin/Owner or `roles.manage` · maintenance mode on · production-critical flag change · bulk action affecting > 100 records · audit export · publishing AGB/Datenschutz (re-consent) · deactivating an Owner/Admin. Rules: requester ≠ approver, request carries a reason, expires after 24 h, executes on approval, both steps audited (ADM-43).

**Re-authentication:** sensitive actions require a password confirmation within the last 5 minutes (Fortify `password.confirm`), and TOTP is mandatory for all staff (ADM-03 blocks everything until enrolled).

**Owner-only atom (M4.6, ADR-432):** `system.mail_preview` (ADM-61 Mail-Vorschau) belongs to the Owner role only. It is outside the grantable atom list, so ADM-42 cannot give it to another role, and invitations cannot carry it. **Skippable TOTP (ADR-427):** with `STAFF_2FA_REQUIRED=false` (staging) a staff member may skip enrolment for one session; code-gated steps stay closed.

## 3. Modules
**Access (ADM-01…05).** Staff login (separate guard + cookie path `/admin`), TOTP challenge, mandatory enrolment, password reset, 403. Optional IP allow-list (`ADMIN_IP_ALLOWLIST`) and admin subdomain (`ADMIN_DOMAIN`). Session idle timeout 30 min with "Sitzung läuft ab" warning at 25 min.

**Overview (ADM-06…08).** Dashboard: work queues first (Offene Meldungen · Einsprüche · DSGVO-Fristen ≤ 7 Tage · Support-Tickets · Fehlgeschlagene Jobs · Cron/Queue-Status), then KPIs (Neue Mitglieder heute/7/30 Tage, aktive Mitglieder DAU/WAU from `last_seen_at`, veröffentlichte Fahrzeuge, QR-Scans 7 Tage, QR-Scan → Registrierung, Nachrichten 7 Tage — counts only), 3 charts (Registrierungen/Tag 30 Tage; QR-Scans → Registrierungen; Top-Marken), DSA box "Ø monatlich aktive Nutzer (6 Monate)" for Art. 24(3) requests. Global search + ⌘K palette: navigate, find member by email/username, vehicle by slug/public id, QR by code, case by id; run safe actions (open record, copy link). Staff alerts: approvals waiting for me, assigned cases, system warnings.

**Members (ADM-09/10).** List: avatar, @username, name, e-mail (masked unless `members.view_pii`), status, vehicles, followers, registered, last active, 2FA, verified; filters (status, verified, restricted, reported, has vehicles, date ranges); saved views (Neu diese Woche · Eingeschränkt · Gemeldet · Ohne Fahrzeug); bulk (restrict, revoke sessions, export*, delete*) with a per-record result panel. Record tabs: **Übersicht** (profile, status, counters, consents) · **Fahrzeuge** · **Sicherheit & Sitzungen** (devices, 2FA state, login history — dates/devices only) · **Meldungen** (as reporter/target) · **Nachrichten-Metadaten** (conversation count, request rate, blocks — **no content**) · **Audit** · **Datenschutz/Einwilligungen**. Actions: edit fields (drawer), restrict (messaging/publishing, duration, reason, SoR template → member gets email + in-app notice), suspend, unrestrict, send reset link, force password change, revoke all sessions, reset 2FA*, change e-mail after identity check, **view-as** (read-only), export*, delete*.
**View-as:** reason (+ member consent checkbox for support cases) → issues a 30-minute Sanctum token with ability `view-as` → opens `/app` in a new tab with a persistent red banner "Ansicht als @user – nur lesen". Server rejects every non-GET request and all message-content endpoints for that ability. Start/stop audited.

**Vehicles & media (ADM-11…13).** Vehicle list/record (tabs Details · Fotos · Mods · QR · Verlauf · Meldungen); hide/unhide with reason (owner notified with SoR), delete; media review queue (newest uploads, reported media, [AI] risk score when `ai.moderation_triage` is on) with hide/approve and keyboard shortcuts (J/K next/prev, H hide, A approve).

**Catalogue (ADM-14…17).** Makes/models/generations CRUD with merge; "Anfragen" tab = member catalogue requests (approve → create entry and relink the vehicle; reject with reason). Mod categories + field-schema editor (type, unit, min/max/step, options, required, searchable, facet; fields with data are archived, never deleted; schema versions audited). Brands: normalise, aliases, merge duplicates ("Akrapovic" → "Akrapovič"). CSV import: dry-run diff → apply (catalog.import), errors per row.

**QR (ADM-18/19).** Registry with status, vehicle, owner, created, scans (7/30 days); detail with daily scans chart and history; revoke/reissue with reason (owner notified).

**Moderation — DSA (ADM-20…24).** Queue tabs Neu · In Prüfung · Entschieden · Einsprüche; priority by reason and repeat reports; [AI] triage score + one-line reason when enabled (label "KI-Vorschlag", human decides). Case detail: target preview, all reports, history, evidence, member's prior decisions, decision composer: action (keine Maßnahme · Inhalt entfernen · Einschränken · Sperren) + duration + **statement of reasons** template fields — facts and circumstances, ground (Community-Richtlinien § / AGB § / law), whether automated means were used, redress options (internal appeal within 6 months, out-of-court dispute settlement, court) — editable before sending; notifications to reporter and affected member. Appeals reviewed by a different staff member than the original decider. Messaging safety: reported messages with ±10 messages of context only, access audited. Rules: keyword lists (block/flag), rate-limit overrides. SoR templates DE/EN.

**Support (ADM-25…27).** Tickets from SET-15 and the web contact form (WEB-10); assignment, status (offen/wartet/gelöst), internal notes, replies (email + in-app), macros (DE/EN).

**Brand & content (ADM-28…35).** Brand & theme: logo set (wordmark white/black, square, app-style mark), welcome/landing/splash hero images with focal point, OG default image, **accent set from the pre-validated palette**, default theme — all as config versions. Home curation: featured builds (date range), collections (title, query/filter or hand-picked vehicles). Announcements: title/body DE/EN, CTA, audience (all/new/members with vehicles), schedule, dismissible. Legal documents: Markdown editor + preview, versions, locale; publishing AGB/Datenschutz with "requires re-consent" → members are asked to accept on next app start. Help articles. E-mail & push templates (subject/body DE/EN with variables, test send to me). **Draft preview:** renders `/app` and the public vehicle page with the draft config (signed preview token) in mobile and desktop frames × Carbon/Schwarz/Hell. Version history with JSON diff and one-click rollback (audited).

**Configuration & releases (ADM-36…38).** Feature flags (key, description, enabled per environment, staff-only rollout, percentage rollout for member flags; critical flags need four-eyes). Remote config: min/latest versions per platform, force-update message, maintenance mode* with DE/EN message and staff bypass. Release register: version name/code, platform, channel (lan/staging/production), APK SHA-256, notes, date (synced from `docs/RELEASES.md` via `php artisan speedclub:releases-sync` or entered manually).

**Team & roles (ADM-39…43).** Staff list; invite by e-mail (signed link → set password → mandatory TOTP); deactivate; role assignment with permission diff; permission matrix (role × atom) with diff confirmation; approvals queue (approve/deny with comment).

**Audit & privacy (ADM-44…47).** Audit log with filters (actor, action, target, date), event drawer with before/after diff, chain status ("Integrität geprüft: 02:00 ✓"), export* (CSV/JSONL). GDPR requests (Auskunft, Export, Löschung, Berichtigung, Widerspruch) with due date (1 month; extension + 2 months with reason), status, evidence of completion, templates. Retention settings (defaults below).

**System (ADM-48…50).** Health (spatie/laravel-health: DB, cache, queue backlog, failed jobs, cron heartbeat, disk usage, storage link, GD WebP support, PHP version/extensions, mail config, Pusher reachability, AI provider reachability, last backup, audit chain). Jobs: pending/failed with retry/forget. Integrations: status only — **never show secrets**; test buttons (send test e-mail to me, test push to my device token, test Pusher event, test AI call).

**Mail-Vorschau (ADM-61, M4.6, non-production only).** The last 50 outgoing mails of a host whose mailer is `log`, so demos work without SMTP. Owner only (`system.mail_preview`); the list shows metadata only (recipient, subject with codes masked, time, type); opening a mail is audited (`system.mail_preview_opened`). The route is not registered in production and the controller refuses there too.

**Settings (ADM-51/52).** My staff account (password, 2FA, sessions). Org settings: company identity for Impressum and e-mails (name, address, representative, contact, register, VAT ID), support e-mail, default locale.

**Memberships — flagged scaffold (ADM-F1/F2, `premium.enabled` off).** Plans (name, features list, active) and entitlements (grant/revoke manually with reason and end date, audited). No payment processing in V1; future digital premium must use Apple IAP / Google Play Billing; physical stickers/merch may use Stripe.

## 4. Retention defaults (editable in ADM-47, documented in the privacy policy)
Deactivated accounts → hard delete after 30 days · messages of deleted members: other side keeps copy, sender anonymised · media of deleted vehicles 30 days · verification codes 24 h · idempotency keys 24 h · Sanctum tokens: expired pruned daily · staff IP and user agent for audit events 12 months (`audit_event_access`, outside the hash chain) · audit events and daily JSONL exports 24 months, then archived export until 36 months (ADR-113) · support tickets 24 months · moderation cases 36 months (legal defence) · QR scans: aggregated counts only, no personal data · application logs 14 days · backups 30 days.

## 5. Admin UI patterns (build once, reuse everywhere)
`DataTable` (server-side sort/filter/paginate via spatie/laravel-query-builder, column chooser, saved views, sticky header, selection + bulk bar, CSV export behind permission), `RecordLayout` (header with status + actions, tabs, right activity timeline from audit), `Drawer` (edit forms), `ConfirmDialog` (typed confirmation "LÖSCHEN" for irreversible actions; reason field when required), `ApprovalNotice` (shows when an action needs four-eyes and what happens next), `DiffViewer` (JSON/text), `KpiTile`, `Sparkline`, `ChartCard`, `EmptyQueue` (queue-zero states), `PermissionGate` (UI-only hint; server is the authority), `CommandPalette` (⌘K). All tables show German labels, tnum numbers right-aligned, dates "14.06.2026, 18:42".

## 6. Seeding
`StaffSeeder` creates the Owner from `STAFF_OWNER_EMAIL` with a random password printed once to the console (local/staging) and forces TOTP enrolment at first login. In local/staging only: one demo staff per role (`DEMO_STAFF_PASSWORD` from `.env`). Never seed demo data in production.
