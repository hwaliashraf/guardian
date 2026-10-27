# Project Spec — Parental Control App (Working Title: "Guardian")

**Version:** 0.1 (Draft)
**Date:** July 2026
**Benchmark product:** Mobicip (feature parity target + 3 differentiators)

---

## 1. Vision

A cross-platform parental control app that matches Mobicip's core capabilities while adding three features no mainstream competitor offers well:

1. **Always-on VPN that blocks adult content and adult/ad networks** — zero adult ads reaching the child, enforced with defense-in-depth.
2. **Usage buckets** — screen time is not just a daily total; it is governed by session length caps, mandatory breaks, and total time, so a child cannot burn 4 hours of allowance in one sitting.
3. **Presence/attention detection** — if the child walks away while a game or YouTube is left running, the screen locks and the timer stops counting (parent-configurable signals, from touch-inactivity up to camera presence checks).

Target users: parents of children aged ~5–16, multi-device households.

---

## 2. Platforms & Tech Stack

### 2.1 Platform strategy

| Platform | v1 scope | Notes |
|---|---|---|
| **Android (child device)** | Full feature set | Primary target. All 3 differentiators fully supported. |
| **iOS (child device)** | Reduced "companion" set | Web filtering via Safari content blocker + DNS profile; screen time via Apple FamilyControls API (requires Apple entitlement approval); **no** background camera, **no** system-wide ad inspection. |
| **Android + iOS (parent app)** | Full | Dashboard, reports, controls — identical on both. |
| Windows / macOS / Chromebook | v2 | Mobicip covers these; deferred. |

### 2.2 Stack

- **App shell / UI:** React Native (single codebase, parent + child apps as two build targets or one app with role selection).
- **Native modules (Android, Kotlin):**
  - `VpnService` — local VPN for DNS filtering.
  - `AccessibilityService` — foreground app detection, in-app content signals, anti-tamper.
  - `Device Admin / Device Owner API` — uninstall protection, screen lock.
  - `UsageStatsManager` — app usage accounting.
  - `CameraX + ML Kit face detection` — presence checks (foreground service, explicit consent).
- **Native modules (iOS, Swift):** `NEDNSSettingsManager` (DNS filtering), `FamilyControls / ManagedSettings / DeviceActivity` (screen time), Safari Content Blocker extension.
- **On-device ML:** TensorFlow Lite NSFW image classifier (e.g., open NSFW models) for in-browser image scanning.
- **Backend:** managed cloud (Firebase or Supabase for v1) — auth, family/device registry, policy sync, activity event ingestion, push (FCM/APNs). Policy changes push to child devices in near-real-time.
- **Web dashboard (v1.5):** React, reusing API.

---

## 3. Feature Parity with Mobicip (Baseline Requirements)

### 3.1 Screen time management
- Daily and weekly screen time limits, per child, per device or aggregated across devices.
- Per-app and per-app-category time limits.
- Schedules/routines: homework, bedtime, mealtime, school — with tailored app/website access per routine. Separate weekday/weekend sleep times.
- Vacation mode with an end date that auto-restores normal schedules.
- Instant pause: parent locks all family devices with one tap.

### 3.2 Content filtering
- DNS + browser-level web filtering with **30+ categories** (adult, porn, violence, gambling, advertisements, social, games, etc.).
- Age-based filter presets (auto-configured from child's age).
- Whitelist-only mode for young children.
- Custom allow/block lists for domains and keywords.
- Enforced SafeSearch on Google/Bing/DuckDuckGo and Restricted Mode on YouTube.

### 3.3 App management
- Block/allow installed apps; preemptive blocking of apps by store rating (e.g., block all 17+/Mature by default).
- Per-app time limits (a Mobicip weak spot — we do it properly, per app not just per category).
- New-app-install alerts to the parent.

### 3.4 Location
- Real-time GPS location on family map, location sharing both ways.
- Geofences with enter/leave alerts; 30-day location history.

### 3.5 Monitoring & reports
- Activity timeline: app usage, browsing history, searches, blocked attempts.
- YouTube video history (titles/links of watched videos).
- Weekly digest email/notification to parents.
- (v2) Social media conversation monitoring — large scope, deferred.

### 3.6 Child dashboard & collaboration
- Child sees their own remaining time, buckets, and schedules (transparency reduces circumvention).
- Child can request: extra time, unblock a site/app, schedule change. Parent approves/denies from a push notification.

### 3.7 Tamper resistance
- Uninstall protection (Device Admin) + instant parent alert on uninstall/disable attempt.
- Alert if VPN, accessibility service, or location is turned off; optional auto-lock device until restored.
- PIN-protected settings on the child device.

### 3.8 Accounts & tiers (mirrors Mobicip's model)
- **Free:** 1 device, website blocker, instant pause.
- **Standard:** up to 10 devices — app blocker, schedules, screen time, locator.
- **Premium:** up to 20 devices — VPN adult-ad shield, usage buckets, presence detection, per-app limits, priority support.

---

## 4. Differentiator 1 — VPN Adult/Ad Shield

**Goal:** no adult advertisement or adult content reaches the child's screen, in any app or browser.

**Reality check:** system-wide HTTPS payload inspection is not feasible (certificate pinning, privacy, and store policy). So the guarantee is built as **layered defense**, where each layer catches what the previous one missed:

- **Layer 1 — DNS filtering (system-wide, all apps).** Local `VpnService` intercepts DNS; queries checked against continuously updated blocklists: adult domains, ad networks, adult ad networks, trackers, DoH/DoT bypass endpoints. Blocks ~90–95% of ad/adult delivery at the network edge. Also force-routes SafeSearch CNAMEs (e.g., forcesafesearch.google.com).
- **Layer 2 — In-browser ML image scanning.** Inside the bundled safe browser (and via extension where possible), every rendered image above a size threshold passes through an on-device NSFW classifier (TFLite, <50 ms/image). Flagged images are blurred/blocked before display; repeated hits on a page block the page and alert the parent.
- **Layer 3 — Accessibility-based text heuristics (Android).** The accessibility service watches on-screen text in third-party apps for adult-ad keyword patterns; on match, the screen is covered with a block overlay and the event is logged.
- **Layer 4 — Bypass prevention.** Block known VPN/proxy apps, private-DNS override detection, blocklist of DoH resolvers, alert on network setting changes.

**Non-goals (v1):** decrypting third-party app traffic; scanning video frames in third-party apps (evaluate for v2 via MediaProjection with consent).

**KPI:** <0.5% adult-ad impressions passing all layers in test harness; DNS filter latency <10 ms added per query; battery cost <3%/day.

---

## 5. Differentiator 2 — Usage Buckets

Screen time is governed by **four interacting counters**, all parent-configurable per child, globally and per app/category:

| Counter | Example | Behavior |
|---|---|---|
| **Total daily time** | 4 h/day | Classic allowance. Resets at a parent-set time (default midnight). |
| **Max session length** | 45 min | Continuous-use cap. A session = usage without a qualifying break. At the cap, the device (or app) locks. |
| **Mandatory break** | 15 min | Minimum lock-out after a session ends before a new session can start. Countdown visible to the child. |
| **Session count (optional)** | max 5 sessions/day | Prevents gaming the system with many tiny sessions. |

**Rules & edge cases:**
- A break shorter than the mandatory break duration does **not** reset the session clock (e.g., locking the phone for 2 minutes doesn't earn a fresh 45).
- 5-minute and 1-minute warnings before session end, with a gentle "wrap up" prompt (lets the child save a game).
- Grace finish (optional, parent toggle): +3 minutes once per session to reach a save point.
- Buckets can differ by category: e.g., games = 30 min sessions / 20 min breaks, but reading apps unlimited sessions.
- Buckets compose with schedules: a session cannot cross into bedtime.
- Child dashboard shows: time left today, current session remaining, next break length — full transparency.
- Multi-device: counters sync across the child's devices via backend (offline devices reconcile on reconnect; conservative local enforcement while offline).

---

## 6. Differentiator 3 — Presence / Attention Detection (Open Question → Concrete Plan)

**Problem:** child leaves YouTube or a game running and walks away; the timer keeps burning (or content keeps autoplaying).

**Design: a signal ladder, parent-configurable.** Each level is opt-in; higher levels are more accurate but more privacy-sensitive.

1. **Level 0 — Media/interaction heuristics (always on, no sensors).** No touch, scroll, or key input for N minutes while a "watched" app (games, video) is foreground → dim screen → warning → lock/pause. For video apps, distinguish "watching" (expected no-touch) from "abandoned" using audio-focus + occasional interaction prompts ("Still watching?" tap within 30 s, YouTube-style).
2. **Level 1 — Device motion.** Accelerometer/gyroscope: a handheld device that goes perfectly still on a table for N minutes while a game is foreground strongly implies abandonment. Cheap, no camera, works offline.
3. **Level 2 — Periodic camera presence check (Android only).** With explicit setup consent and a persistent notification, a foreground service samples the front camera for ~1 second every N minutes and runs **on-device** face detection (ML Kit). Result is a single boolean — *face present / not present*. **No images ever leave the device; no images are stored; no face recognition, only detection.** Two consecutive "no face" samples → pause timer + lock screen.
4. **Parent-configurable policy:** which levels are enabled, N-minute thresholds, and what happens on trigger — (a) pause the usage timer only (fair to the child), (b) lock the screen, or (c) both.

**Bonus fairness feature:** when presence detection triggers, the abandoned minutes are *refunded* to the child's daily bucket — turns a surveillance feature into something the child actually wants enabled.

**Privacy guardrails (non-negotiable):**
- Camera level requires opt-in on the child device during setup, a visible persistent notification, and a child-dashboard indicator.
- On-device inference only; boolean events only in logs; feature is off by default.
- Documented plainly in the privacy policy; likely a differentiating trust point, not a liability, if done this transparently.

**iOS:** Levels 0–1 only (no background camera access). Ship as Android-exclusive selling point.

---

## 7. Architecture Overview

```
 Parent App (RN) ──┐
                   ├── Backend (Auth, Family/Policy DB, Event ingest, Push)
 Child App (RN) ───┘        │
   │  native layer          └── Blocklist pipeline (adult/ad feeds, updated daily, CDN-delivered)
   ├── VpnService (DNS filter)
   ├── AccessibilityService (foreground app, text heuristics, anti-tamper)
   ├── UsageStats + Bucket engine (local, offline-capable)
   ├── Device Admin (lock, uninstall protection)
   └── Presence service (input/motion/CameraX+MLKit, on-device)
```

- **Offline-first enforcement:** all blocking and bucket logic runs locally; the backend is for policy sync and reporting, never a single point of failure for enforcement.
- **Policy push latency target:** <10 s from parent tap to child device (FCM high-priority).

---

## 8. Compliance & Store Policy

- **COPPA / GDPR-K:** verified parental consent flow at signup; data minimization (no raw images, no message content in v1); child data deletion on account close.
- **Google Play:** must declare Accessibility + VpnService + Device Admin usage; parental-control apps are an allowed category for these APIs but require a prominent disclosure screen and policy justification. Camera use requires foreground-service type `camera` and clear disclosure.
- **Apple:** FamilyControls entitlement application required (weeks of lead time — start early); Screen Time API is the only sanctioned mechanism.

---

## 9. Milestones (Suggested)

| Phase | Duration | Deliverable |
|---|---|---|
| M0 | 2 wks | Detailed technical design, blocklist sourcing, Apple entitlement application submitted |
| M1 | 6 wks | Android child app: DNS VPN filter + web filtering + app blocking + uninstall protection; RN parent dashboard (policies, instant pause) |
| M2 | 4 wks | Bucket engine (sessions/breaks/totals, multi-device sync), schedules, child dashboard |
| M3 | 4 wks | Presence detection Levels 0–2, refund mechanic; in-browser NSFW ML layer |
| M4 | 3 wks | Reports/timeline, location + geofencing, request/approve flows |
| M5 | 3 wks | iOS companion (DNS profile, FamilyControls, Safari blocker), hardening, Play/App Store review prep |

---

## 10. Open Questions

1. Bundled safe browser vs. relying on Chrome + DNS only? (Safe browser gives Layer-2 ML scanning; recommend bundling.)
2. Should presence-triggered pauses notify the parent every time, or only summarize in the daily report?
3. Free-tier scope — does the VPN shield stay Premium-only, or does a basic DNS adult filter ship free as an acquisition hook?
4. Blocklist sourcing: license a commercial feed (e.g., a categorized threat/adult feed) vs. curate open lists (StevenBlack, OISD, HaGeZi)? Commercial feeds cost money but cut maintenance.
5. Social media monitoring (Mobicip Premium feature) — v2 or out of scope entirely?
