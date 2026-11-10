# 01 — Client Brief (SOURCE OF TRUTH)

> **Contract rule:** This document is the client's requirement. V1 must satisfy **every** point of §10 and the navigation of §8.
> Nothing in other docs may contradict it. If anything conflicts, **this file wins**, then `02_PRODUCT_SPEC.md`, then the rest.
> Additions beyond the brief are allowed only when labelled (see "Scope layers" below) and must never change the brief's meaning.

---

## A. Client brief — verbatim

**SPEED CLUB スピードクラブ — App Concept & Project Overview | Initial Developer Brief**

**1. The Core Idea**
SPEED CLUB is envisioned as a modern community app for car enthusiasts, tuning fans, and vehicle owners, initially focused on Germany. Users can showcase and manage their cars, document modifications, discover other builds, and connect with the people behind them.
The goal: create a digital home for car culture, with each vehicle having its own detailed, shareable profile. Cars and builds—not generic social-media content—are the center of the experience.

**2. The Digital Garage**
Each user creates an account and can add multiple vehicles to a personal garage. Every vehicle has its own profile with photos, a description, and technical information.
- Make, model, model year, engine, horsepower and torque
- Photos and a short description
- Wheels and tires, suspension, exhaust and engine upgrades
- Other modifications and ongoing changes

For example, someone viewing a BMW M4 can see exactly which wheels, suspension and exhaust the owner has installed. Owners can update their builds over time.

**3. User Profiles & Community**
Each member has a personal profile and unique username, displaying the vehicles they own. Members can search for other users, view their cars, follow profiles, send private messages, and share vehicle pages.
Important: SPEED CLUB should not feel like another Instagram clone. The focus is on vehicles, specifications, modifications and meaningful connections between enthusiasts.

**4. Vehicle QR Codes & Stickers**
Every vehicle receives a unique QR code linking directly to its public vehicle profile. Users can generate and download the code, and eventually order a personalized SPEED CLUB window sticker with the logo, username and QR code.
Example: someone spots a modified Nissan Skyline in a parking lot, scans the sticker and immediately sees the car's photos, specs, modifications and owner profile.
The QR link should also open a public mobile-friendly webpage without requiring the app to be installed. Visitors can then choose to register or download the app.

**5. Discover Vehicles**
Users should be able to discover cars as well as people. Search and filtering could include make, model, model year, horsepower, wheels, suspension and specific modifications.
For instance, a BMW M4 owner could browse other M4 builds to compare wheel setups and find inspiration for their own car.

**6. Events & Car Meets**
In a later phase, SPEED CLUB can help connect the online community in real life. Members could discover legal meets and automotive events nearby, explore them on a map, see details, indicate interest and create their own meetups.

**7. Visual Identity & Design**
The visual direction is JDM / underground / automotive street culture: predominantly black and charcoal backgrounds, white typography, subtle red accents, high-quality car photography and distinctive SPEED CLUB branding.
The logo uses expressive brush-style lettering with Japanese text. The app interface itself should remain clean, premium, simple to navigate and easy to read. Strong brand character should not come at the expense of usability.

**8. Suggested Main Navigation**
- Home: interesting cars, recent builds and community activity
- Discover: search for vehicles, specifications, modifications and users
- My Garage: add, edit and manage personal vehicles
- Messages: direct conversations between members
- Profile: personal profile, settings and access to vehicle QR codes

An Events section can be introduced later rather than included in the initial release.

**9. Future Opportunities**
- SPEED CLUB Shop: custom QR stickers, apparel and merchandise
- Business profiles: tuning shops and garages showcasing their work
- Parts integration: link installed modifications to manufacturers and products
- Marketplace: buy and sell used wheels, suspension parts and accessories
- Premium membership: optional advanced garage and profile features

These are long-term ideas, not requirements for the first version.

**10. First Version — Keep It Simple**
The first release should concentrate on the essential experience:
- Account registration and login
- Personal user profiles
- A garage supporting multiple cars
- Vehicle profiles with photos and technical specifications
- A structured way to document modifications
- Search for users and vehicles
- Private messaging
- Unique QR codes for each vehicle
- Public, browser-accessible vehicle profile pages

Additional features should be added gradually after the core experience works well.

**11. The Vision**
SPEED CLUB aims to become a recognizable automotive community in Germany, connecting three things: CARS (vehicles and builds), PEOPLE (owners and enthusiasts), and CULTURE (the passion for tuning and automotive life).
The defining idea is the bridge between the physical and digital worlds: a real car can lead directly to its own online profile through a SPEED CLUB QR sticker.
SPEED CLUB should feel like a home for people who love, personalize and share their cars—not simply another social network.

---

## B. Client visual references (described; originals to be placed in `design/brand/`)

**Logo:** white, expressive brush/graffiti-style "SPEED CLUB" wordmark with Japanese katakana スピードクラブ between thin horizontal rules, on a black grunge/brush-stroke textured background. Wide and square versions exist.

**Prototype board (10 phone screens, light row + dark row, German copy):**
- HOMEPAGE: brush-logo header, full-bleed night car-meet photo, hero "MORE THAN A BRAND / CARS. PEOPLE. LIFESTYLE.", outlined button "ZUR COMMUNITY →", section "AKTUELLE EVENTS" with "Alle anzeigen", event card "NIGHT MEET MÜNCHEN, 14 JUN".
- COMMUNITY: tabs Feed / Members / Events; Instagram-style posts (lukas.sc, Stuttgart DE … ~326 likes, 12 comments; jann.ptrs "Neue Felgen drauf. Was sagt ihr?").
- SHOP: tabs Alle / Bekleidung / Accessoires; merch grid (SC Logo Hoodie €69,90 …).
- GARAGE: tabs "Meine Fahrzeuge" / "Entdecken"; large dark photo cards; "Hauptfahrzeug" badge; "NISSAN GT-R R34 — 2.6L Twin Turbo | 500 PS | JDM — Details →"; "BMW M3 E92 — 4.0L V8 | 420 PS | Daily".
- PROFILE: cover + avatar, "lukas.sc" with verified tick, "Stuttgart, DE", "Mitglied seit März 2023", stats row (Fahrzeuge / Events / Beiträge / Follower), "Über mich", horizontal strip "Meine Fahrzeuge".
- BOTTOM NAV on the board: Home / Community / Shop / Garage / Profil.

**How to use the board:** follow its *mood* (monochrome, night photography, brush branding at the edges, "Hauptfahrzeug", German copy). Do **not** copy its weaknesses: tiny secondary text, crowded metadata, small targets, huge branded headers, an Instagram-style like/comment feed, and fake stats. **Navigation conflict:** the board shows Community/Shop; the brief (§8) wins → Start · Entdecken · Garage · Nachrichten · Profil. Shop and Events are FUTURE.

---

## C. Requester (agency) requirements — Hassam, team lead

These are added by the agency on top of the brief. They are **[AGENCY]** scope and are mandatory:
1. **Three products:** React Native mobile app (Android + iOS); a **member web app with 100% the same interface and features** (fallback when the app has issues); a **super-admin "god mode" portal**.
2. **Admin god mode:** users, data, (future) subscriptions/entitlements, audit logs ("maximum record"), roles & permissions, restrict/allow users, force password resets, revoke sessions, design/branding/image changes, content, configuration.
3. **Themes:** "dark and black" following the black-and-white logo → **Carbon (dark, default) + Black (OLED)**, plus **Hell (light)** because daylight QR scans and the client's own board need it, plus **System**.
4. **Quality bar:** agency-standard, premium, pixel-precise; must not look AI-generated; smooth, lightweight, fast, secure; professional animations; zero known layout bugs.
5. **Signed Android APK at every milestone**, plus automated testing so the requester does not test manually.
6. **Fast delivery** in 3 phases, each ending with a handoff.
7. **Deployment target: shared hosting** (PHP + MySQL; **no Node.js at runtime**). Node is allowed only on the developer PC for builds.
8. Additional **AI and non-AI features** researched and offered to the client — built behind admin feature flags so the brief stays intact.

---

## D. Scope layers (label every feature with one)

| Label | Meaning | Ships in V1? |
|---|---|---|
| **[PDF]** | Brief §10 list + §8 navigation | Yes — mandatory |
| **[ESSENTIAL]** | Required by stores, EU/German law or basic usability (recovery, verification, settings, legal pages, report/block, in-app + web account deletion, empty/error states, notifications for messages, moderation, audit) | Yes — mandatory |
| **[AGENCY]** | Section C above | Yes — mandatory |
| **[SIGNATURE]** | Researched extras (non-AI), behind admin feature flags, default ON in staging for the client demo | Built in V1, client decides launch state |
| **[AI]** | Researched AI features, behind flags, labelled per EU AI Act Art. 50 | Built in Phase 3, client decides |
| **[FUTURE]** | Brief §6 Events, §9 Shop, business profiles, parts, marketplace, premium (only data-model hooks + admin entitlement scaffold) | No |

**Never in V1:** likes/comment threads/Instagram feed, Stories/Reels, Shop, Events, marketplace, fake counts, legality judgements on modifications.
