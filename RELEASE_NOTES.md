# Release notes · Payday (payday.mcbflow.com)

Newest first. One entry per release, in plain words a user would understand.

## 1.2 · 2026-10-14

- **Moved to payday.mcbflow.com.** Data saved at mbpayday.online doesn't carry over: export a backup there and import it here.
- Storage names simplified.

## 1.1 · 2026-10-14

- On computers, the search box, backup status and logo spacing now look exactly like the other mb apps: same size, same "Search…" text and the same "/" shortcut.
- **Cleaner top bar on phones.** The app name no longer gets cut off ("mbpayday.onli…"). Data, the light/dark switch and Clock in are now matching square buttons, the same as in the other MB apps.
- **Clock in shows a clock icon** (a stop icon while you're on shift). On phones it's an icon-only button; on computers it still says "Clock in" or "Clock out" with your running pay.
- **The light/dark switch shows a sun and a moon** so it's clear what it does.

## 1.0 · 2026-10-14

First release as part of the MB Suite. The earlier single-file version of mbpayday.online had no version number. Your saved shifts, paystubs, jobs and settings carry over as they are (same storage, no data migration), and backups from the earlier version still import.

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
