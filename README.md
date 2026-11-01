# Canvas Notes

A notes app where every page is a free canvas. Put text, images, checklists, code and tables anywhere, group pages, tag them, and browse them as cards with live thumbnails.

It runs on your laptop (Linux, also Windows and macOS) and on Android. The two keep the same notes by syncing directly over your Wi-Fi. There's no account, no server and no internet involved. Pages live in a SQLite database and images are plain files next to it.

## Features

- **Free canvas.** Drag a box by the **Move** handle in its bar, or by grabbing just outside or inside its edge (the cursor turns into a move cursor). Resize from the corner, overlap them, and send them to the back. The page has no edges: scroll or pan in any direction and more canvas opens up, so you can place boxes above and to the left of where you started as well as below and to the right. **Ctrl + 1** zooms to fit everything on the page, which is handy when you've wandered far. Pinch to zoom on phones.
- **Reordering list items.** Hover a checklist item and drag the ⠿ handle on its left to move it; a blue line shows where it will land. With the cursor in an item, **Alt + ↑ / ↓** moves it too. One move is one undo step.
- **Multi-select.** Drag across empty space or Shift-click to select several boxes, then move, duplicate or delete them together.
- **Undo and redo** for everything on the canvas (Ctrl+Z, Ctrl+Shift+Z, or the header buttons). Typing in one box counts as a single step.
- **Rich text** (TipTap): headings, bold/italic/underline/strike, lists, quotes, inline code and links. Formatting is kept when you paste from other apps.
- **Images** can be pasted, dropped or picked from a file. Originals are kept, except files over 4096 px, which are scaled down.
- **Groups and subgroups.** Groups can hold subgroups, as many levels deep as you like, shown as a tree in the sidebar that you can expand and collapse.
  - Choosing a group shows its pages plus everything in its subgroups. The title shows where you are, e.g. "Work / ML projects".
  - In a group's **⋯** menu: **New subgroup…**, **Move into** another group (or back to the top level), rename, colour and delete. On the laptop you can also drag a group onto another to nest it, or onto the "Groups" heading to bring it back to the top.
  - Deleting a group never deletes its contents. Its pages and subgroups move up a level.
  - A new subgroup takes its parent's colour, which you can change.
- **Library:**
  - Cards show a real miniature of each page.
  - Groups get coloured tabs.
  - Tags work as filters.
  - Search covers everything written on the pages.
  - On the laptop, you can drag a card onto a group in the sidebar.
  - A deleted page can be restored from the "Undo" toast.
- **Trash.** Deleted pages go to **Trash** in the sidebar, where you can **Restore** them or **Delete forever**. After 30 days (or the 7 or 90 you choose in Settings) a trashed page's content is removed automatically. The deletion itself still syncs to your other devices, and so does **Delete forever**, so a page you removed for good can't be restored from another device.
- **History.** The **History** button in a page's header lists earlier versions of the page with a miniature of each. **Restore this version** puts back its boxes and arrows (the title, tags and group stay), and Ctrl+Z undoes it. A version is saved at most once an hour while you edit, and also before a sync replaces your copy with another device's. Hourly versions are kept for 2 days, then one per day for 30 days. History stays on the device where you made it and is never synced.
- **Snap guides.** While you drag or resize, a box's edges and centre snap to other boxes' edges and centres, and a pink line shows the match. Hold Alt to move freely.
- **Connector arrows.** Hover a box to show four connection dots; drag from a dot onto another box to draw an arrow between them (dropping on empty space cancels). Arrows always take the shortest side-to-side route and stay attached as either box moves or resizes. Click an arrow to select it, then use its menu to set a label, choose arrowheads (none / one end / both) or switch between a solid and dashed line. Delete removes the selected arrow; deleting a box removes its arrows too, as one undo step.
- **Frames.** Add a labelled, coloured area from the toolbar to group boxes together. Drag a frame by its title bar to move everything inside it; resizing a frame leaves its contents where they are. Frames can be nested inside other frames. Rename a frame inline, pick its colour from its title bar, and collapse it to a title bar only, hiding its boxes (and their arrows) until you expand it again. Deleting a frame keeps its boxes — they just stop belonging to it. Frames always sit behind boxes, and work with snap guides, undo/redo, sync, thumbnails and exports like any other box.
- **Templates.** **Save as template** (in a page's card menu, or in the editor's header) keeps a copy of its layout and boxes: text, lists, tables, stickies, frames, arrows and drawing. **New page** now opens a picker with **Blank** and every template, each shown as a live picture; the new page is a fully independent copy with its own boxes, titled with the template's name. Templates don't appear in the library, search, tag counts or trash.
- **Starter templates and managing them.** Six starters are added the first time you open the app: Meeting notes, Weekly review, Project plan, To-do list, Brainstorm board (stickies in frames) and Daily page. They're ordinary templates: edit or delete them freely (a deleted one doesn't come back). **Templates** in the sidebar lists them as cards; click one to edit it like a page, under an **Editing template** banner, or use its menu to rename, duplicate, delete, make a page from it, or **Use for daily pages**. Deleting a template doesn't change pages already made from it. **Settings** (bottom of the sidebar) chooses which template new daily pages start from.
- **More templates.** Fifteen further starters join the original six (they appear in **Templates** the first time you open an updated app, and removing one is permanent, as before): **Form builder**, **Registration form**, **Feedback survey**, **Mind map**, **Kanban board**, **SWOT analysis**, **Priority matrix**, **Cornell notes**, **Flowchart**, **Habit tracker**, **Budget tracker**, **Study plan**, **Retrospective**, **Trip planner** and **Decision matrix**.
  - **Form builder** has a *Field palette* (short answer, paragraph, multiple choice, dropdown, date, rating), a *Your form* frame to assemble the form in, and a *Form logic* frame with arrows for the flow. Select a palette field, press Ctrl+D, drag the copy into your form and retype its label. Fields are ordinary boxes (a table is the input, a list gives tick boxes), so forms export, sync and print like any other page.
  - If you opened an earlier build of these, the starters you have never edited are replaced once by the redrawn versions (one you changed, renamed or deleted is left alone).
  - **Mind map** is spread across a wide canvas and makes the most of the page having no edges: keep adding branches in any direction.
- **Daily tracking and attendance.** In a checklist's hover bar, **Track daily** makes it a daily habit list. The app remembers which items you checked each day, and clears the checks when you open the page on a new day (it never works in the background; the day is closed as soon as you open the list or come back to it). **Attendance** (shown once tracking is on) makes a page called "Attendance: …" with a summary table (days done, days counted, percentage, current and best streak per item) and a **GitHub-style heatmap** (a square per day, a column per week with Monday at the top, up to a year back): the greener a day, the more of the list you did; grey means missed and an outline is today until you've done something. There is one for the whole list, with a summary table beside it (days done, days counted, percentage, current and best streak per item), and one for each item below. A day with nothing checked counts as missed, including days you didn't open the app. The attendance page updates itself as you tick things and whenever you open it; the heatmaps are pictures that are redrawn only when they change, and the rest are ordinary tables, so you can move them, add your own notes beside them, export it, or edit the checklist's items freely (an item added later is only counted from the day you added it). A tracked list has no **Clear done** (its items are what the history is kept for), and copies of a tracked list or a template made from it start with no history. **Stop tracking** forgets the daily record. Tracking is kept in the checklist itself, so it syncs like any page, and older app versions just show the list.
- **Daily page.** **Today** in the library (or **Ctrl+Alt+D** anywhere) opens today's page, made from the daily template if it doesn't exist yet. It's titled by date ("Mon, 19 Oct 2026", from the computer's local date) and filed in an automatic **Daily** group. A daily page has a bar with previous and next day and a **calendar**; days that have a page carry a dot, and picking any day opens it or creates it. The **Calendar** button in the library opens the same calendar. Daily pages are never created in the background, only when you open a day, and which template they start from is set in **Settings**. If two devices each make the same day before they sync, the older page stays the daily page and the other becomes an ordinary page titled "… (second copy)" (nothing is merged or lost). On some desktops Ctrl+Alt+D is taken by the system (for example KDE's "show desktop"); the Today button always works.
- **Sticky notes.** **Sticky** in the toolbar (or press **S** with nothing being typed into) drops a 200 × 200 coloured note: under the pointer if it's over the page, otherwise in the middle of what you can see. It's a small text editor with bold, italic and bullets, a slight shadow, and the same move, resize, layer, duplicate and undo as any box. Drag a sticky by its text to move it; double-click it (or select it and press Enter) to type. Long notes scroll inside the note. Pick one of 8 muted colours (or none) from the note's hover bar; the next sticky starts with the colour you last picked for one. Colours follow the light and dark theme and the text colour is chosen to stay readable. Markdown exports a sticky as a `> 📝` quote with its colour in a comment; PNG and PDF show the real colour.
- **Colour.** Every box has a colour button in its hover bar (8 muted colours, or none): a background tint for text, lists, code, tables and stickies, and a border for pictures. Frames take the same colours (their header text switches to dark or light to stay readable) and keep their original palette under **Classic colors**. In the library, a page card's menu has **Card color**, shown as a stripe down its left edge with a soft tint. Colours follow the light and dark theme, and one colour change is one undo step.
- **Drawing on the page.** **Draw** in the toolbar lets you draw anywhere on the page, among your text boxes, frames and pictures, with [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT licence): pen, shapes, arrows, text and eraser. The tools appear over the page with your boxes showing through; scroll or zoom inside it and the page moves with you. Press **Done** when finished. Edits are saved as you draw, and Excalidraw keeps its own undo while you're drawing. Ink sits above the boxes, never blocks clicking them, and stays where it is when you move a box (it belongs to the page, not to a box). Thumbnails, PNG and PDF exports include it, and Markdown exports save it as `images/drawing.svg` in the zip. Excalidraw is only downloaded into the app the first time you open draw mode, and its fonts are bundled, so drawing works offline. Chinese, Japanese and Korean text in a drawing uses your system font.
- **Export** any page from its header (**Export**) or from its card's menu:
  - **Markdown:** text, checklists, code and tables in reading order, with arrows listed under a **Connections** heading and each frame's contents nested under a heading named after it. Pages with pictures become a `.zip` holding the `.md` file and an `images/` folder.
  - **PDF:** one page, sized to your content and drawn exactly as on the canvas. It's a picture of the page, so its text isn't selectable. Use Markdown when you need the text.
  - **PNG:** a sharp image of the page at twice screen resolution.
- **Settings** (bottom of the sidebar), in six tabs:
  - **Profile:** a display name and colour, shown as an avatar at the top of the sidebar. It's local to the device; there are no accounts and nothing is sent anywhere.
  - **Appearance:** Match my system, Light or Dark. Exports are always light.
  - **Editor:** turn snapping to other boxes and the grid on or off (Alt still frees a single drag), and choose the daily-page template.
  - **Sync:** on the phone, turn automatic background syncing off (the Sync button still works); shortcut to the pairing and sync panel.
  - **Data:** **Back up all notes** saves every page, group and picture to one `.json` file; **Restore from backup** adds back anything you don't already have (existing pages are never overwritten, and pages in Trash aren't backed up). Also how long deleted pages stay in Trash: 7, 30 or 90 days, applied when the app starts.
  - **About:** version, where your notes are stored, and a keyboard shortcut list.
- **Command palette, quick switcher, outline and graph view.** **Ctrl + P** opens a palette of commands (new page, today's page, settings, theme, undo and more); **Ctrl + O** is a quick switcher that finds a page by a few letters of its title. Both match loosely, so "wkrv" finds "Weekly review"; Up/Down chooses and Enter opens. A page's **Outline** button lists its headings (H1–H3 in text boxes) and frame titles in reading order, and the pages it links to with `[[Page title]]`; click one to jump there. **Open graph view** in the palette draws every page as a dot and every `[[link]]` as a line; click a dot to open the page. All of this is worked out from what is already on your pages, so nothing new is stored or synced and older app versions are unaffected.
- **Wi-Fi sync** between your phone and laptop. See below.
- **Nothing is ever silently overwritten.** If a page was changed in two places at once (two windows, or the phone and the laptop between syncs), both versions are kept and one is named "(conflicted copy)".

| Shortcut (laptop) | Action |
| --- | --- |
| Double-click empty space | New text box |
| Ctrl + Z / Ctrl + Shift + Z | Undo / redo |
| Delete | Remove selected boxes |
| Ctrl + D | Duplicate selected boxes |
| Ctrl + A | Select all boxes |
| Arrow keys | Nudge (hold Shift for 1 px) |
| Enter / Esc | Start / stop editing the selected box |
| Space + drag, or middle mouse | Pan |
| Ctrl + scroll, Ctrl + = / − / 0 | Zoom |
| Ctrl + 1 | Zoom to fit everything on the page |
| Alt while dragging | Turn off snapping (guides and the 8 px grid) |
| Right-click a page card | Page menu (rename, export, move, delete) |
| Delete, with an arrow selected | Remove the selected connector |
| Type `[[Page title]]` in a text box | Link to another page. The other page then shows a **Linked from** button in its header, listing every page that links to it |

**On a phone:**
- **Double-tap empty space** for a new text box, and **tap a box** to edit it.
- **Long-press a box** to start selecting. Tap more boxes to add or remove them, drag any selected box to move them all together, and tap **Done** when finished. The **Select** button in the toolbar does the same.
- **Pinch** to zoom.
- **Long-press a page card** for its menu: rename, export, move to a group, delete.

---

## 1. Laptop setup (Ubuntu 26.04)

Run these in the regular **Terminal** app rather than VS Code's built-in terminal. The Snap version of VS Code confines its terminal, so tools installed from there can end up in a temporary folder.

**System libraries Tauri needs:**

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

**Rust 1.90 or newer.** Ubuntu's default `rustc` is older, so use rustup:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Choose the default install, then open a new terminal and check:
rustc --version
```

**Node.js** 20.19+ or 22.12+ (check with `node --version`).

**Run it:**

```bash
cd canvas-notes
npm install
npm run desktop
```

The first launch compiles the Rust side. On an 8 GB laptop expect roughly 5 to 10 minutes; later launches take seconds.

To build an installable app, run `npm run desktop:build`. This produces a `.deb` (double-click to install with the Software app) and an AppImage in `src-tauri/target/release/bundle/`.

## 2. Phone setup (Android)

Building for Android needs Android Studio, which brings the Android SDK, the NDK and Java.

1. **Install Android Studio:** `sudo snap install android-studio --classic`, then open it once and finish the setup wizard.
2. In Android Studio, open **More Actions → SDK Manager**:
   - On **SDK Platforms**, tick the newest Android version.
   - On **SDK Tools**, tick **Android SDK Build-Tools**, **NDK (Side by side)**, **Android SDK Command-line Tools** and **Android SDK Platform-Tools**.
   - Click **Apply**.
3. **Tell the build tools where everything is.** Add these lines to the end of `~/.bashrc`, then open a new terminal:

   ```bash
   export JAVA_HOME=/snap/android-studio/current/jbr
   export ANDROID_HOME="$HOME/Android/Sdk"
   export NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 "$ANDROID_HOME/ndk" | sort -V | tail -1)"
   ```

4. **Add Rust's Android targets:**

   ```bash
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```

5. **Prepare your phone:**
   1. Go to **Settings → About phone** and tap **Build number** seven times. This turns on Developer options.
   2. In **Developer options**, turn on **USB debugging**.
   3. Plug the phone in and accept the prompt on its screen.
6. **Create the Android project** (once): `npm run android:init`
7. **Run it on the phone:** `npm run android:dev`. The phone must be on the same Wi-Fi as the laptop, because it loads the app from the laptop while you develop.

**To install the app permanently,** run `npm run android:apk`. The APK appears in `src-tauri/gen/android/app/build/outputs/apk/`. Copy it to the phone and open it, or run `adb install <file>.apk`.

This is a debug build, which is fine for your own phone. A Play Store release needs a signing key; see https://v2.tauri.app/distribute/sign/android/.

Gradle (Android's build tool) is memory-hungry. Close the browser and other big apps during the first Android build.

## 3. Sync between phone and laptop

1. **On the laptop:** open Canvas Notes, click **Sync**, and turn on **Let my phone sync with this laptop**. It shows the laptop's address and a pairing code.
2. **On the phone:** open Canvas Notes, tap **Sync**, enter the address and the code, and tap **Connect**.

After that the phone syncs on its own:
- when the app opens or comes back to the front
- every two minutes while it's open
- about 20 seconds after you edit

This works whenever both devices are on the same Wi-Fi and the app is open on the laptop. **Sync now** forces it immediately.

**How it works.** The laptop runs a small service on port 47821, and the phone talks to it directly. Every message is encrypted (ChaCha20-Poly1305) with a key made from the pairing code. The code itself never travels over the network, so other devices on the Wi-Fi can't read or fake sync traffic. **New pairing code** on the laptop locks out phones using the old code.

**What syncs:** pages, groups and subgroups, tags and images, plus deletions. Update the app on both devices together: an older phone app treats subgroups as top-level groups, and if you edit one there, its nesting is lost.
- A page edited on only one side between syncs takes that side's version.
- A page edited on both sides is kept twice: the laptop's version under the original name, and the phone's as "(conflicted copy)".
- An edit beats a deletion: if one side deleted a page the other side was still editing, the page stays.

**If the phone can't connect:**
- Check both devices are on the same network, not a guest network.
- If Ubuntu's firewall is on, run `sudo ufw allow 47821/tcp`.
- If the laptop's address changes every few days, reserve a fixed IP for it in your router's settings (often called "DHCP reservation").
- The phone's and laptop's clocks must be within 5 minutes of each other. Automatic time on both handles this.

## Where your notes are

**Laptop:** `~/.config/dev.jjn8805.canvasnotes/`
- `canvas-notes.db`: pages, groups, tags and settings (SQLite)
- `images/`: every image, as normal files

To back up, copy that folder.

**Phone:** in the app's private storage. With sync on, the laptop holds a full copy too.

Images that no page uses any more are cleaned up when the app next starts. Images used by a page in the Trash, or by a saved version in History, are kept.

## Development

```bash
npm run assets     # copies Excalidraw's fonts into public/ (dev and build do this for you)
npm run dev        # UI in a browser at http://localhost:1420 (notes stored in IndexedDB, no sync)
npm test           # sync and storage tests, run against a real SQLite database
npm run typecheck
cd src-tauri && cargo test   # encryption tests for the sync transport
```

Two kinds of tests run against the real code:
- Snap-guide maths, and Markdown and PDF output. The PDFs are checked with real PDF tools.
- Sync: two copies of the real storage code, a "laptop" and a "phone", synced through the real engine.

Sync scenarios covered:
- first sync onto a new phone
- edits in both directions, with images
- conflicts, and deletions both ways
- edit-versus-delete
- group renames
- a stale overwrite being refused
- 12 mixed edits converging
- upgrading a database from the first version of the app

### Project layout

```
src/
  storage/
    tauri.ts               SQLite + image files (laptop and phone), schema migrations
    web.ts                 IndexedDB fallback for `npm run dev`
  export/export.tsx        PNG/PDF rendering, a tiny PDF writer, Markdown conversion, saving
  lib/guides.ts            snap-guide maths
  lib/arrows.ts            connector routing maths (shortest side-to-side route)
  lib/groups.ts            group tree (nesting, loop protection)
  lib/frames.ts            frame containment tree (nesting, paint order, collapse)
  sync/
    engine.ts              what to send, fetch, or keep as a conflicted copy
    controller.ts          laptop service, phone connection, automatic syncing
  store/                   pages, undo history, canvas state, images, toasts/dialogs
  components/
    library/               sidebar, cards, thumbnails
    editor/                header, canvas (drag/resize/marquee/pan/zoom), block frame
    blocks/                text (TipTap), checklist, code, table, image
    sync/                  Sync panel
src-tauri/
  src/sync.rs              encrypted transport: LAN service (laptop) and client (phone)
  capabilities/default.json  permissions: SQL, files inside the app folder only
tests/                     sync and storage tests
```

### How data is stored

Each page is one row; its `blocks` column is JSON:

```json
{ "id": "…", "type": "text", "x": 136, "y": 64, "w": 432, "h": 40, "z": 1, "html": "<p>…</p>" }
```

A page's `arrows` column is likewise JSON: each entry references two block ids (`from`/`to`)
rather than storing its own position, so its route is always recomputed from the current
blocks. Missing from a record written by an older app version, it's just treated as `[]`.

A frame is just another entry in `blocks` (`"type": "frame"`, with its own `title`, `color`
and `collapsed`), and a block names the frame it's inside via `frameId` — so frames need no
schema changes, migration, or sync-engine code; undo/redo, sync and storage all already work
generically off `blocks`.

Pages and groups also carry three sync fields:
- `etag`: changes on every save.
- `synced`: the version both devices last agreed on.
- `deleted`: deleted rows are kept as markers so the deletion can sync.

To add a new kind of box:
1. Add its type in `types.ts`.
2. Add a body component in `components/blocks/`.
3. Render it in `BlockFrame.tsx`.
4. Add a toolbar button in `Editor.tsx`.

Undo, saving, sync and thumbnails work for it without changes.

Schema changes go in `MIGRATIONS` in `src/storage/tauri.ts`. Each entry runs once.

## App icon

Replace `app-icon.png` (1024×1024) with your own and run `npm run icons`.

## Future ideas

- Turn the idea of groups into notebooks, sections or categories.
