# Atsuko V1 Implementation Plan

This plan is based on the **Atsuko Product Requirements Document (V1.0)**.
It explains what was understood, what will be added, what will be changed, and what will not be touched.

---

## 1. What Was Understood
- **Core Idea:** Atsuko is an offline music player for Windows desktop (Chrome / Edge / PWA). It stores all user data in a single JSON file called `atsuko.atu` inside a user-chosen **Data Folder**.
- **Backup & Restore:** By copying the Data Folder to another PC, the user keeps their profile, playlists, favourites, folders, and stats. When they re-select their songs, Atsuko matches them automatically using a fast 256 KB file hash.
- **Atsuko Folders:** A built-in way under Library -> Folders to group songs (like "28 Oct" or "2025") when adding them. One song belongs to at most one Atsuko Folder. Deleting a folder keeps songs in All Songs.
- **Recorder:** Saves voice recordings as real `.mp3` files into the Data Folder (or `Recordings` subfolder if present) and adds them to the library.
- **Data Safety:** Never lose user data during app updates or restarts. Safe writes use `atsuko.atu.bak` rolling backup and an IndexedDB cache for fast startup.

---

## 2. What Will Be Added (New Files & Modules)
To keep the existing codebase clean, new features will be placed in dedicated modules:

1. **`js/dataFolderService.js`**
   - Connects to the Data Folder via the File System Access API.
   - Saves and reads `atsuko.atu` and `atsuko.atu.bak`.
   - Stores directory and file handles in IndexedDB for easy reconnects.
   - Multi-tab safety lock using `BroadcastChannel`.
2. **`js/atuSchema.js`**
   - Defines the V1 JSON schema and data validation.
   - Handles migrations from older schema versions safely.
3. **`js/songFingerprint.js`**
   - Reads the first 256 KB + file size to create a fast SHA-256 hash.
   - Implements song matching rules (Hash -> Name+Size+Duration -> Relative Path).
4. **`js/folderService.js`**
   - Manages Atsuko Folders (create, rename, delete, move song, unsorted list).
   - Renders the Library -> Folders page and folder song lists.
5. **`js/recorderService.js`**
   - Microphone recording with Record, Pause, Resume, Stop, Discard, and timer.
   - Converts audio to genuine `.mp3` using client-side `lamejs`.
   - Saves `.mp3` into the Data Folder and adds it to the "Recordings" folder.
6. **New UI Components (Modals & Dialogs):**
   - **Welcome / About Wizard:** 4-step first-run guide with Next/Back/Skip/Get Started.
   - **Choose Data Folder Screen:** Pick folder with validation (empty, existing `.atu`, or warnings).
   - **Add-to-Folder Dialog:** "Which folder should these songs go in?" with date suggestion and existing folder dropdown.
   - **Folder Reconnect Banner:** Unobtrusive banner when folder permission needs a click.
7. **SEO & PWA Assets:**
   - `robots.txt`, `sitemap.xml`, and `404.html` (SPA redirect for GitHub Pages).
   - Social preview image (`og:image`) and rich meta tags.

---

## 3. Existing Files I Will Touch (Smallest Necessary Edits)
- **`index.html`:**
  - Add SEO meta tags (title, description, Open Graph, Twitter cards, JSON-LD, canonical).
  - Add markup for Welcome Wizard modal, Add-to-Folder dialog, and Reconnect banner.
  - Connect existing HTML stubs for Folders (`#foldersLeftSection`) and Recorder (`#exploreRecorderItem`).
  - Add `<noscript>` crawler content and Service Worker update toast.
- **`js/app.js`:**
  - On launch: check if Data Folder exists. If not, trigger Welcome Wizard; if yes, load cached data and sync `.atu`.
  - Wire Library -> Folders navigation and click actions.
  - Wire Library -> Recorder graphical card to the new recorder service.
  - Add debounced auto-save (1–2 seconds) when playlists, favourites, profile, or settings change.
  - Safe "Clear Local Library" confirmation dialog with optional `.atu` wipe checkbox.
- **`js/fileManager.js`:**
  - Before importing songs, trigger the "Which folder should these songs go in?" dialog.
  - Use `songFingerprint.js` to skip duplicates and save file handles in IndexedDB.
- **`manifest.json`:**
  - Add description, categories, screenshots, and app shortcuts.
- **`sw.js`:**
  - Cache new scripts (`dataFolderService.js`, `lamejs`, etc.).
  - Handle safe `SKIP_WAITING` when the user clicks "Update available".
- **`css/style.css`:**
  - Style the Welcome Wizard, folder dialogs, reconnect banner, and recorder interface, matching the dark aesthetic.

---

## 4. What Will NOT Be Touched
- **Home / All Songs:** List view, lyrics view, 3-column cover grid, Up Next view.
- **Controls & Views:** All / Column / Shuffle buttons, 5-column view, mini player.
- **Vertical Left Toolbar:** All icons and navigation flows remain identical.
- **Library Sections:** Artists, Albums, Favourite, and Genre pages remain identical.
- **Profile Modal:** Name, avatar, and Atsuko Stats tab keep their exact look.
- **Settings Modal:** Theme, master volume, equalizer presets, and Voice Assistant toggle.
- **Core Player Engine:** Audio playback, queue management, and voice assistant remain intact.

---

## 5. Assumptions (from Section 15 of PRD)
1. A song belongs to **one** Atsuko Folder only.
2. MP3 files are **not copied** into the Data Folder; they stay where the user keeps them.
3. The `Recordings` subfolder is only used if it already exists; otherwise recordings go to the root of the Data Folder.
4. The data file is `atsuko.atu` (UTF-8 JSON).
5. Album art is not stored in `.atu`; it is read directly from the music files.
6. Target platform is **Chrome and Edge on Windows desktop** (graceful warning on other browsers).

---

## 6. Implementation Steps
1. **Foundation:** IndexedDB storage, Data Folder handle management, safe `.atu` read/write with rolling `.bak`.
2. **First-Run Flow:** Welcome Wizard, Choose Data Folder, folder inspection/validation.
3. **Add Songs & Atsuko Folders:** Fingerprint hashing, duplicate skipping, Add-to-Folder dialog, and Folders UI.
4. **Auto-Save & Persistence:** Hook playlists, favourites, profile, settings, and stats to `.atu`.
5. **Restore Flow:** Detect returning user, reconnect songs by fingerprint, mark missing files.
6. **Recorder:** In-browser MP3 recording via `lamejs`, save to Data Folder, add to library.
7. **Launch & Error Safety:** Reconnect prompt, multi-tab lock, browser support check.
8. **SEO & PWA Polish:** Meta tags, social cards, sitemap, robots, manifest update, Service Worker refresh toast.
9. **Final Verification:** Check every item on the PRD Acceptance Checklist.

