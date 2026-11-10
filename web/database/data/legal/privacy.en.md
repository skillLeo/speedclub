---
status: draft
review: lawyer review required before launch
source: docs/08_LEGAL_COMPLIANCE.md sections 1, 3, 4, 5; docs/06_ADMIN_SPEC.md section 4
---

# Privacy policy

This page explains what data SPEED CLUB processes, why, and for how long. We only collect what the service really needs: we do not ask for your date of birth or phone number, and we do not store your precise location.

## 1. Controller

[[Firmenname]] [[Rechtsform]]\
[[Anschrift]]\
[[PLZ und Ort]]\
Germany\
Email: [[Datenschutz-E-Mail]]

Data protection officer: [[Name and contact, if appointed]]

## 2. What data we process

| Area | Data | Purpose | Legal basis |
|---|---|---|---|
| Account | Email address, password (hash only), username, "at least 16 years old" confirmation, time and version of your acceptance of the terms and this policy | Running your account, sign-in | Art. 6(1)(b) GDPR |
| Profile | Display name, city (optional free text), short bio, avatar and cover photo | Your public profile | Art. 6(1)(b) GDPR |
| Garage | Vehicles, specs, modifications, photos, descriptions, inspection due month | Your build and its public page | Art. 6(1)(b) GDPR |
| Community | Who you follow and who follows you, saved vehicles, members you blocked | Following, saving, protection from unwanted contact | Art. 6(1)(b) GDPR |
| Messages | Content and times of your conversations | Delivering messages | Art. 6(1)(b) GDPR |
| QR codes | Only a count of scans per code and day | Statistics for you, operations | Art. 6(1)(b) and (f) GDPR |
| Devices and sessions | Device name, platform, app version, last use, push token | Sign-in, device management, push | Art. 6(1)(b) GDPR |
| Settings | Notifications, language, appearance, power unit, privacy options | Making the app behave the way you set it | Art. 6(1)(b) GDPR |
| Two-factor protection | Encrypted secret and recovery codes, time of setup, only if you use it | Securing your sign-in | Art. 6(1)(b) GDPR |
| Access data | IP address and browser or app identifier (user agent) in sessions and server logs, IP address briefly for rate limits | Operation, abuse prevention | Art. 6(1)(f) GDPR |
| Security | Security events, application logs, abuse prevention | Keeping the service secure | Art. 6(1)(f) GDPR |
| Reports and moderation | Reports, decisions, reasons, appeals; in the report form without an account (/melden) also your name and email address, if you give them; for reported messages the reported message and up to 5 messages before and after it | DSA obligations, protecting the community | Art. 6(1)(c) and (f) GDPR |
| Support | Your requests, our replies, times | Helping you | Art. 6(1)(b) and (f) GDPR |
| Data protection requests | Type and time of your request, status, proof of completion | Fulfilling your rights and being able to show it | Art. 6(1)(c) GDPR |
| Marketing emails | Email address, only if you separately agreed | News from SPEED CLUB | Art. 6(1)(a) GDPR |

Our legitimate interest under (f) is secure, abuse-free operation and accountability for actions taken by our staff.

## 3. What is publicly visible

SPEED CLUB is a community, so your profile and vehicles are public by default, including to people without an account and through the QR code on your car. You can change this:

- Set each vehicle to "Public", "Unlisted" or "Private".
- Decide whether search engines may find your profile.
- Decide who may message you and turn read receipts off.

## 4. Photos, number plates and faces

Every photo is re-saved on upload, which removes metadata such as GPS position and camera data. Number plates and faces can be personal data, so please think about them before uploading. Where available, you can obscure them with our tool. The decision is yours.

## 5. QR codes

When someone scans your QR code, we only increase a daily counter for that code. Scans by known bots do not count, and yours do not count only when you are signed in on the same browser. We store neither an IP address nor a user account with the counter. We process the IP address only briefly during the request, to limit abuse.

## 6. Cookies and storage on your device

We only use strictly necessary storage under § 25(2) TDDDG:

- in the web app, the session and form protection (XSRF); the public pages (home, QR, vehicle and member pages, legal texts) set no cookies for guests,
- your sign-in token on the device,
- your appearance, language and power unit settings,
- the list of your recent searches, which stays on your device only and which you can delete in "Discover" at any time,
- an offline cache of recently loaded content, so the app works without a connection; we clear it when you sign out,
- the queue for photo uploads, so an upload survives an app restart,
- in the report form (/melden), the contact form (/kontakt) and the account deletion form (/konto-loeschen), Cloudflare Turnstile for abuse prevention, if we have turned it on. The report form itself sets no cookie; we process your IP address there only briefly for rate limiting.

Staff have a separate session in the admin area. That is why there is no cookie banner. We use no analytics and no advertising services.

## 7. Recipients and processors

We have data processing agreements with these providers, or conclude them as soon as the service is used:

| Service | Purpose | Location |
|---|---|---|
| [[Hosting-Anbieter]] | Running server and database | EU |
| [[E-Mail-Anbieter]] | Sending emails | EU |
| Pusher | Real-time message delivery | [[Check region]] |
| Expo | Relaying push notifications | USA |
| Apple Push Notification Service, Google Firebase Cloud Messaging | Delivering push notifications | USA |
| [[S3-kompatibler Speicher]], if used | Storing photos | EU |
| Cloudflare, if used | Abuse protection (including Turnstile) and delivery | [[Check region]] |
| [[KI-Anbieter]], if AI features are active | The AI features you trigger, photo suggestions on upload and the internal pre-sorting of reports | [[Check region]] |

Push notifications contain no message content unless you turn on previews yourself. For transfers to the USA we rely on [[adequacy decision or standard contractual clauses, under review]].

## 8. AI features

AI features are only active if we have turned them on.

**Features for you:** You trigger search, suggestions for mods and descriptions, and translations yourself. When you upload photos, AI can suggest a category, and the photo is sent to the AI provider for this. We label all of this "AI suggestion", "AI-assisted search" or "Translated (AI)". Nothing is published without your confirmation. Before first use we explain what data is processed. The legal basis is Art. 6(1)(b) GDPR.

**Internal pre-sorting:** If we have turned it on, AI pre-sorts incoming reports and photos and suggests a priority with a short reason to our team. You do not trigger this yourself, and the AI provider receives the reported content for it. The legal basis is our legitimate interest in effective moderation and our DSA obligations (Art. 6(1)(c) and (f) GDPR). A human always decides, and the statement of reasons says whether automated means were involved.

AI never judges whether a modification is legally permitted.

## 9. How long we keep data

| Data | Period |
|---|---|
| Deactivated accounts | final deletion after 30 days at the latest |
| Photos of deleted vehicles | 30 days |
| Individually deleted photos | public files immediately, the private original after 30 days |
| Messages of deleted members | The other person keeps their copy, the sender shows as "Deleted member" |
| Verification codes | 24 hours |
| Accounts whose email address was never confirmed | 7 days after registration |
| List of your known devices (checksum and time only, for the security email about new devices) | 12 months after the last sign-in from the device |
| Expired sign-in tokens | removed daily |
| IP address and user agent in sessions | until the session expires or you sign out |
| IP address for rate limits | until the time window ends, 24 hours at most |
| Server logs of the host | [[Check period with the hosting provider, 14 days at most]] |
| Application logs | 14 days |
| Backups | [[Check the period once backups are set up, target 30 days at most]] |
| Security events of your account (for example a changed password, two-factor protection, sessions) | 24 months, then as an archived export until 36 months have passed |
| Log of admin actions | 24 months, then as an archived export until 36 months have passed |
| Staff IP addresses and user agents for the log | 12 months |
| Follows, saved vehicles, blocks | until you remove them or your account is deleted |
| Two-factor protection data | until you turn it off or your account is deleted |
| Support requests | 24 months |
| Data protection requests | [[Set the period with legal counsel]] |
| Moderation cases | 36 months for legal defence |
| QR scans | daily counts only, no personal data |

## 10. Your rights

You have the right of access (Art. 15), rectification (Art. 16), erasure (Art. 17), restriction (Art. 18), data portability (Art. 20) and to object to processing based on legitimate interests (Art. 21). You can withdraw consent at any time with effect for the future. We reply within one month.

You can do much of this yourself:

- **Export your data:** In settings you get a ZIP archive with your data and photos.
- **Delete your account:** In the app or at /konto-loeschen. Your account is deactivated immediately and finally deleted within 30 days.
- **Correct your data:** Directly in your profile and garage.

For anything else, write to [[Datenschutz-E-Mail]]. You can also complain to a supervisory authority, for example [[Zuständige Aufsichtsbehörde]].

## 11. Age limit

SPEED CLUB is for people aged 16 and over. We only store your confirmation, not a date of birth.

## 12. Changes

If this policy changes materially, we tell you in the app and ask for your consent again where needed.

Last updated: [[Datum]], version 1. This translation is provided for convenience. The German version is binding.
