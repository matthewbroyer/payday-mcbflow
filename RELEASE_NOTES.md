# Release notes · Payday (payday.mcbflow.com)

Newest first. One entry per release, in plain words a user would understand.

## 1.4 · 2026-10-16
- **New Settings page.** Appearance, Account & sync, Payday settings (your jobs, pay rates, pay periods and overtime rules), the take-home estimate, Backup & data, Install and About, in that order, the same as the other mcbflow.com apps. On phones it's the first item under More.
- **Account button** in the top bar: "Sign in" when you're signed out, your initial and a sync dot when you're signed in. New "Keep me signed in on this device" switch (on by default; off signs you out when the browser closes).
- **Same welcome screen as the other apps:** Welcome, Pick a look, Your job and pay (name, hourly rate, how often you're paid, overtime), then sample data, Sign in to sync or Import a backup.
- **Clearer Data menu.** Every item has a one-line description. New Export All (CSV) (all your shifts) next to Export All (JSON); the old "Export All (CSV, .zip)" is now called Export All (ZIP). Export This Page (CSV) shows on Timecard and Paycheck check. The same list is in Settings → Backup & data.
- **Quieter backup reminders when synced.** While you're signed in and syncing, the backup chip reads "Synced", the Data menu shows no warning dot, and Home doesn't ask you to back up.
- **Monthly earnings in Reports is now a bar chart** with gridlines and an average line. Hover, tap or tab to a month to see its pay, hours and shifts. The best and average month are written under the chart.
- **Even top bar:** every control is the same height, including the light/dark switch.
- **New name style:** "Payday ∙ mcbflow.com" (just "Payday" on phones). A short footer with What's new, Privacy, Terms and More free apps sits at the bottom of every page.
- Photos and files open in the app: Payday doesn't store photos or files, so nothing changes here.
- **New color: Slate.** Payday's accent changes from rose pink to slate gray-blue, with a matching new logo, app icons and share image. Same clock-and-coin mark; light and dark mode both updated.
- **Profile picture and screen name.** Signed in, choose a screen name and one of 20 profile pictures (Account → Edit profile). It shows on the account button and in Settings, and in every mcbflow.com app you sign in to.
- **A greeting on Home:** "Good morning", or "Good morning, Matthew" with your screen name when you're signed in.
- **Overview is now called Home**, with the same house icon as the other apps, and Settings has a proper gear icon.

## 1.3 · 2026-10-15
- New: optional sync across devices. Data → Sync signs in with a free mcbflow.com account; shifts, paystubs, jobs, settings and a running clock stay in step on every device you sign in on. Everything still saves on this device first and works offline; changes sync when you're back online.
- First sign-in on a device that already has records asks whether to merge, use the account's copy, or use this device's copy.
- Sample records never sync. Clear all data warns when you're signed in, since it clears synced data too.
- Not signed in: nothing changes, and the app contacts no server.

## 1.2 · 2026-10-14

- **Moved to payday.mcbflow.com.** Data saved at the old address doesn't carry over: export a backup there and import it here.
- Storage names simplified.

## 1.1 · 2026-10-14

- On computers, the search box, backup status and logo spacing now look exactly like the other mb apps: same size, same "Search…" text and the same "/" shortcut.
- **Cleaner top bar on phones.** The app name no longer gets cut off. Data, the light/dark switch and Clock in are now matching square buttons, the same as in the other MB apps.
- **Clock in shows a clock icon** (a stop icon while you're on shift). On phones it's an icon-only button; on computers it still says "Clock in" or "Clock out" with your running pay.
- **The light/dark switch shows a sun and a moon** so it's clear what it does.

## 1.0 · 2026-10-14

First release as part of the MB Suite. The earlier single-file version of the app had no version number. Your saved shifts, paystubs, jobs and settings carry over as they are (same storage, no data migration), and backups from the earlier version still import.

- **New look.** MB Suite design with a left sidebar on computers, an icon rail on tablets and a bottom bar on phones, a Rose accent, light and dark mode, and a new clock-and-coin logo.
- **Data menu** at the top of every page: Save backup now (Ctrl/Cmd+S), Export All (JSON), Import Backup, Export This Page (CSV) and Export All (CSV, .zip). On Chrome and Edge, Save backup now keeps updating the file you picked the first time. A small chip shows when you last backed up.
- **Safer imports.** The app checks a backup before changing anything, shows what's new and what's already there, and lets you Merge (the default, skips duplicates) or Replace. Importing the same file twice no longer doubles your shifts. Files from other apps are turned away.
- **Undo** after deleting a shift or paystub. Clearing all data, replacing on import and deleting a job ask once, with Cancel as the default and a "Save backup first" option.
- **Sample data** is now offered on the welcome screen and on an empty Overview, labeled "Sample" wherever it shows, and removable in one click (Data → Remove sample data). Old "DEMO" sample records from the earlier version are recognized and can be removed the same way.
- **Timecard search and job filter**, with times shown as 7:00 AM / 5:30 PM.
- **Share a finished pay period or your year so far** as an image. Pay amounts and job names stay off the image unless you turn them on.
- **Install it as an app** (Settings, in Chrome/Edge/Android, or Add to Home Screen on iPhone). Works offline after the first visit, including ZIP backups.
- **No outside requests.** The ZIP library used to load from a CDN; it now ships with the app, so nothing about your visit goes to third parties.
- The app now always opens in light mode unless you picked dark (it used to follow the device setting).
- Added a welcome screen, a storage warning if this browser can't save, a Privacy page, a Terms page and a "page not found" page.
- About card at the bottom of Settings: version, release date, links and copyright in one place.
- Installing from matthewbroyer.com: the hub's Install button opens the app with a short install prompt.
