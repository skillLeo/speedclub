# 08 — Legal, Privacy & Store Compliance (design-shaping requirements)

> Not legal advice. The team writes **drafts with placeholders** (`[[Firmenname]]`, `[[Anschrift]]` …) into the CMS seed (`LegalDocumentSeeder`); the client's lawyer must review Impressum, Datenschutzerklärung, AGB and Community-Richtlinien before launch. The product must be built so these texts are true.

## 1. GDPR (DSGVO) — privacy by design & default
- **Data minimisation:** no birth date (only a 16+ confirmation), no phone number, no precise location (city is free text, optional), EXIF/GPS stripped from every upload, **QR scans stored as daily counts only** (no IP, no user id), no third-party analytics or ad SDKs in V1.
- **Legal bases:** account, garage, messaging, QR = contract (Art. 6(1)(b)); security logs, abuse prevention, aggregated statistics, staff audit = legitimate interest (Art. 6(1)(f)); marketing e-mails = consent (Art. 6(1)(a), separate unticked checkbox); AI features = user-initiated, explained at first use.
- **Defaults:** profile public (it is a community), vehicles public unless set otherwise, **push message previews off by default** (content passes through Expo/Apple/Google), read receipts on but switchable, search-engine indexing switchable.
- **Rights:** export (SET-12, ZIP within minutes), deletion (SET-13 + web `/konto-loeschen`, completed ≤ 30 days), rectification (edit), objection/complaints via support; admin GDPR queue with the **one-month deadline** (Art. 12(3)).
- **Processors (DPA required, list in Datenschutz):** shared host (EU), e-mail provider (EU), Pusher (realtime), Expo (push relay; US), Apple APNs / Google FCM (US), optional S3-compatible storage (EU), optional AI provider (Phase 3; check data-processing terms and region), optional Cloudflare. Push payloads contain no message content unless the user enabled previews.
- **Retention:** see `06_ADMIN_SPEC.md` §4; the privacy policy states the same numbers.
- **Number plates & faces** can be personal data → upload reminder + blur tool ([SIGNATURE]); the owner decides.

## 2. Impressum (§ 5 DDG) and contact
Reachable in ≤ 2 clicks from every web page and in the app (SET-17/18): provider name + legal form, full postal address, representative, e-mail + a fast electronic contact, register court/number and VAT ID if applicable. Data comes from ADM-52 org settings. The EU online-dispute-resolution platform was discontinued in 2025 — the lawyer confirms whether any consumer-dispute statement (§ 36 VSBG) is needed.

## 3. Cookies & device storage (§ 25 TDDDG)
V1 uses **only strictly necessary** cookies/storage (session, XSRF, staff session, theme/locale preference, auth token on device, offline query cache cleared on logout, upload queue, recent searches (device only, deletable), Cloudflare Turnstile on web sign-up/report forms when configured) → **no consent banner required**; the privacy policy explains them. **Lawyer review:** confirm that this conclusion also covers the offline cache, the upload queue, the recent searches kept on the device (deletable by the member) and Turnstile. If optional analytics is ever added, a consent manager with equal-weight "Ablehnen"/"Akzeptieren" becomes mandatory first.

## 4. Digital Services Act (DSA)
- **Art. 16 notice-and-action:** report flow on every member, vehicle, photo and message (reason → details → sent) and a web form; reports of illegal content capture explanation, location (URL), notifier contact (optional where the law allows) and a good-faith statement.
- **Art. 17 statement of reasons:** every restriction (remove/hide content, restrict, suspend) sends facts, ground (AGB/Community-Richtlinien § or law), whether automated means were used, and redress options (internal appeal, out-of-court dispute settlement, court). Stored on the decision (ADM-21), visible in SAFE-01.
- **Internal complaints:** appeals within 6 months, decided by a different staff member (exempt for micro/small enterprises under Art. 19, built anyway).
- **Art. 24(3):** average monthly active recipients available on request (ADM-06 box).
- **Points of contact (Art. 11/12):** a published e-mail for authorities and users (Impressum + help).
- **Terms (Art. 14):** AGB explain moderation, restrictions and complaint handling in plain language.

## 5. EU AI Act (Art. 50, applicable since 2 Aug 2026)
Every AI feature is labelled "KI-Vorschlag" / "KI-gestützte Suche" / "Übersetzt (KI)"; users are told they are interacting with an AI system where relevant; suggestions are never auto-published; moderation triage is internal and humans decide (and the SoR states if automation was used). No AI-generated car photos.

## 6. App stores
- **Apple:** UGC apps need filtering, reporting, blocking and published contact info (Guideline 1.2); **in-app account deletion** (5.1.1(v)); no third-party social login in V1 → Sign in with Apple not required (4.8); purpose strings for photo library/camera/notifications; age rating consistent with 16+ terms; privacy "nutrition label" matches §1.
- **Google Play:** UGC policy (moderation + reporting), **in-app deletion and a web deletion link** (`/konto-loeschen`) entered in the Data safety form; target API 36 (since 31 Aug 2026); 16 KB page-size support for updates from 1 Feb 2027; use the system **photo picker** (no broad media permissions); notifications permission requested after the primer (AUTH-10).
- **Future premium (FUTURE):** digital features must use Apple IAP / Google Play Billing; physical stickers and merchandise may use an external payment provider.

## 7. Vehicles & German traffic law (copy the app must use)
- **Modifications:** many parts need an ABE, Teilegutachten and/or registration (Eintragung) under StVZO §§ 19/21. SPEED CLUB **never states or implies legality**. The optional legal-status field is owner-declared and always shows: "Angaben des Besitzers, keine rechtliche Prüfung."
- **Street racing:** illegal races are a criminal offence (§ 315d StGB). Community guidelines forbid organising, promoting or glorifying them; the "underground" brand is aesthetic only; future Events list legal meets only.
- **QR sticker placement guide (QR-03) — conservative wording:**
  - "Am sichersten: außen auf der Karosserie (z. B. Kofferraumdeckel, Stoßfänger) oder klein innen in einer Ecke der Heckscheibe."
  - "Heckscheibe nur, wenn dein Auto zwei Außenspiegel hat. Sonst nur ganz am Rand, damit die Sicht nach hinten frei bleibt."
  - "Vordere Seitenscheiben: nicht bekleben."
  - "Windschutzscheibe: möglichst gar nicht. Wenn überhaupt, nur ganz am Rand außerhalb des Sichtfelds und nie im Wischerbereich."
  - "Klein halten: deutlich unter 0,1 m² und nie mehr als ein Viertel einer Scheibe. Nicht spiegelnd, nicht leuchtend, keine Kennzeichen, Leuchten oder Plaketten verdecken."
  - Footer: "Keine Rechtsberatung. Maßgeblich sind die StVZO (u. a. §§ 35b, 40) und die Auslegung der Behörden. Verstöße können ein Bußgeld nach sich ziehen."
  - Print guidance: minimum QR size 30 × 30 mm for scans from ~1 m (larger for longer distances), quiet zone 4 modules, matte vinyl, black on white.

## 8. Accessibility
Target **WCAG 2.2 AA** on web and equivalent native practices (labels, roles, focus order, contrast — enforced by the token gate and axe). The BFSG (since 28 Jun 2025) mainly targets e-commerce and specific services; V1 is likely out of scope, the future Shop would not be — building to AA now avoids rework.

## 9. Content rights
AGB grant SPEED CLUB a non-exclusive licence to display user photos on the platform and in share/OG images of that vehicle; users confirm they own the photos; copyright notices go through the DSA report flow. Car manufacturer names are used descriptively; **no manufacturer logos** in the UI.

## 10. Community guidelines (outline for the CMS draft)
1. Cars first — show your build, be accurate about specs. 2. Respect — no harassment, hate, threats, doxxing. 3. Legal only — no street racing, no instructions to evade inspections or the police. 4. Your content — only photos you own; no nudity or violence. 5. Privacy — think about plates and people in your photos. 6. No spam or undeclared advertising. 7. Consequences — removal, restriction, suspension with reasons and the right to appeal.
