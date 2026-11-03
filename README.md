# Canvas Notes

A notes app where every page is a free canvas. Put text, images, audio, PDFs, checklists, code and tables anywhere, group pages, tag them, and browse them as cards with live thumbnails.

It runs on your laptop (Linux, also Windows and macOS) and on Android. The two keep the same notes by syncing directly over your Wi-Fi. There's no account, no server and no internet involved. Pages live in a SQLite database and images are plain files next to it.

## Features

- **Free canvas.** Drag a box by the **Move** handle in its bar, or by grabbing just outside or inside its edge (the cursor turns into a move cursor). Resize from the corner, overlap them, and send them to the back. The page has no edges: scroll or pan in any direction and more canvas opens up, so you can place boxes above and to the left of where you started as well as below and to the right. **Ctrl + 1** zooms to fit everything on the page, which is handy when you've wandered far. Pinch to zoom on phones.
- **Reordering list items.** Hover a checklist item and drag the ⠿ handle on its left to move it; a blue line shows where it will land. With the cursor in an item, **Alt + ↑ / ↓** moves it too. One move is one undo step.
- **Multi-select.** Drag across empty space or Shift-click to select several boxes, then move, duplicate or delete them together.
- **Undo and redo** for everything on the canvas (Ctrl+Z, Ctrl+Shift+Z, or the header buttons). Typing in one box counts as a single step.
- **Rich text** (TipTap): headings, bold/italic/underline/strike, lists, quotes, inline code and links. Formatting is kept when you paste from other apps.
- **Images** can be pasted, dropped or picked from a file. Originals are kept, except files over 4096 px, which are scaled down.
- **Groups and subgroups.** Groups can hold subgroups, as many levels deep as you like. **Groups** in the sidebar opens a page of group cards (name, colour, page and subgroup counts) with a **Search groups** box that also finds subgroups, by name or by where they sit (e.g. "work ml"). **New group** is at the top of that page.
  - Opening a group shows its subgroups as cards, then its pages plus everything in its subgroups. The title and the links above it show where you are, e.g. "Groups / Work / ML projects"; click any of them to go back up.
  - In a group card's **⋯** menu: **New subgroup…**, **Move into** another group (or back to the top level), rename, colour and delete. On the laptop you can also drag a page card or a group card onto a group card to move it in. The sidebar's **Ungrouped** entry is also a drop target for pages.
  - **Browse groups** and **Browse tags** are in the command palette (Ctrl+P).
  - Deleting a group never deletes its contents. Its pages and subgroups move up a level.
  - A new subgroup takes its parent's colour, which you can change.
- **Desktop widgets (laptop app).** Pin a box or a whole page to your desktop, like Windows Sticky Notes. Use the pin button in a box's bar, **Pin to desktop** in a page card's menu, **Pin this page to the desktop** in the command palette (Ctrl+P), or select several boxes and choose **Pin to desktop** in the bar at the bottom (one widget each).
  - A widget is a small borderless window with a title strip you drag. What's in it is live and editable: type, tick items, and the change is saved to the same page and appears in the main window (and syncs). Edits made elsewhere show up within a few seconds.
  - The strip's buttons: keep it on the desktop (behind other windows) or float it above them, open the page in Canvas Notes, and remove it from the desktop. Position and size are remembered.
  - **Settings → Desktop → Show my widgets when I log in** starts Canvas Notes at login, hidden in the system tray, so the widgets are there as soon as you open the laptop. Closing the main window keeps the app running in the tray (and while any widget is open); **Quit** in the tray menu stops it.
  - If a pinned box or page is deleted, its widget says so and can be removed. On some Linux desktops (Wayland) a window can't be kept behind others: use the float-above setting there.
  - Widgets live in `src/widgets/` (what is pinned, remembered in the settings table) and `src-tauri/src/widgets.rs` (the windows and the tray). A widget window may only read and write the app's own data; it cannot open dialogs, create windows or change start-at-login (`capabilities/widget.json`).
- **Search with filters.** The search box on All pages finds pages whose title, tags or text contain every word you type, in any order (put "quotes" around words that must stay together). Add operators to narrow it: `#travel` or `tag:travel` (exact tag), `has:image` (a box of that kind: text, image, audio, pdf, checklist, code, table, frame, sticky, or drawing), `in:work` (pages in a group whose name contains that, subgroups included), and `after:2026-01-01` / `before:2026-02-01` (last edited on or after / up to the end of that day). They combine: `#plan has:checklist after:2026-03-01 budget`. An operator with a value it can't use (an unknown kind, a date that doesn't exist) is ignored instead of hiding every page. Words used to match the whole phrase; they now match separately.
- **Cards.** **Cards** in the sidebar opens a gallery where each card shows a cover picture and a label (a card with no picture shows the first letter of its label). Click a card to open it: a large picture, the label and a rich-text details box, all editable right there. **Add picture** / **Change picture** / **Remove** manage the cover (with the AI assistant add-on on, **Generate with AI** sits beside them: see Add-ons below); **Open on canvas** opens the card as a full page so you can add more boxes, drawings and arrows around it; **Delete** sends it to Trash.
  - **Tags and sets.** Open a card to give it **tags** (type one and press Enter or comma; tags other cards use are suggested) and choose its **Set**. A set is one of your groups, so sets nest like groups and sync with them; deleting a group moves its cards up a level. In the gallery, the **set** picker shows all cards, only the ones in no set, or one set (with its subgroups), and **New card** creates the card inside the set you are viewing. Tag chips above the cards (with counts for the set shown) filter by tag; click again to clear. In the search box, `#garden` or `tag:garden` matches that exact tag and can be combined with words and other tags (`#travel hotel`).
  - **Board.** The **Gallery / Board** switch in the Cards header shows the cards as columns, one per set: **No set** plus each top-level group (cards in a deeper subgroup sit under their top group). Pick a set to get its own column plus one per subgroup. Drag a card onto another column to move it there; the choice of layout is remembered. Without a mouse, open the card and use its **Set** picker.
  - **New card** is in the gallery's header and the command palette (Ctrl+P, also **Browse cards**). The gallery has its own search (label, details and tags) and sort (label, last edited, newest).
  - Cards are kept apart from pages: they don't appear in All pages, Groups, Tags, search counts or the link graph. Underneath, a card is a page of its own kind (`kind = 'card'`), so it is saved, synced, backed up and trashed like one. Update both devices together: an older app shows a card as an ordinary page and would turn it into one if you edit it there.
- **Library:**
  - Cards show a real miniature of each page.
  - Groups get coloured tabs.
  - Tags work as filters. **Tags** in the sidebar opens a page of every tag with its page count, a **Search tags** box and a sort (name or most pages); open a tag to see its pages.
  - Search covers everything written on the pages.
  - On the laptop, you can drag a page card onto a group card on the Groups page.
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
- **Add-ons (AI assistant, text from pictures).** **Settings → Add-ons** lists optional extras. A switched-off add-on isn't even loaded: it does nothing and makes no network requests. Settings for each appear under its switch once it is on.
  - **AI assistant.** An **Assistant** button in the page header opens a chat drawer beside the page. Choose the provider in Settings → Add-ons: **Ollama** (on this computer by default; "Find models" lists what you have), **Claude** or **ChatGPT** with your own API key. The assistant can be given the page (or only the boxes you've selected, up to about 24,000 characters; a counter shows how much), and offers **Summarize**, **Write a report**, **Make a checklist** and **Improve the wording**. On each answer, **Add to page** puts it on the page as a text box (Markdown becomes headings, lists and bold), **Add as checklist** appears when the answer has `- [ ]` items, and **Copy** copies it. With ChatGPT selected you can tick **Draw a picture instead of answering** to generate a picture with OpenAI's image model and **Add to page** as a picture box. **Stop** ends an answer part-way and keeps what had arrived.
  - **Pictures for cards.** With the AI assistant add-on on, a card's picture options include **Generate with AI**. Describe the picture (the box starts from the card's label), click **Generate**, look at it, then **Use this picture**, **Try again** or **Cancel**; Escape stops a drawing in progress, or closes the dialog. Pictures are always drawn by OpenAI (whichever provider the chat uses), so it needs your OpenAI key; without one the dialog says so and offers **Open settings**. **Only the text in that box is sent**, never the card's details, and nothing is sent until you click Generate. With the add-on off the button isn't there.
  - **Privacy.** A badge shows where your message goes: *On this computer* (Ollama here), *Another computer on your network*, or *Cloud*. Before page text is sent to a cloud or network model, a window shows exactly what will leave (the app's instructions, any earlier messages that go along, and your message with the page) with **Send** and **Don't send**; switching provider mid-chat asks again because the earlier page text would go along. You can turn this question off in Settings. **Chats are never saved**: closing the panel, leaving the page or **New chat** forgets the conversation. The page's text is handed to the model as material, with an instruction not to treat it as commands.
  - **API keys** are kept by the app's Rust side in a file only your account can read (`ai-keys.json` in the app's config folder), not in your notes: never synced, backed up or exported, and the page can't read them back. In the browser preview (`npm run dev`) a key is kept in memory only. Requests go through the Rust side, which sends them only to your Ollama address, `api.anthropic.com` or `api.openai.com`, never follows a redirect, and takes only a few harmless headers from the page.
  - **Text from pictures (OCR).** With a vision model in Ollama (for example `llama3.2-vision`, `qwen2.5vl`, `minicpm-v`), a picture's hover bar gets **Extract text** (then **Re-read text**, **Copy text**, **Clear text**), and the command palette gets **Extract text from the pictures on this page**. The text is saved on the picture's box, so it syncs with the page and **search finds pages by the words inside their pictures**. Pictures go only to Ollama on this computer: any other address is refused. SVGs, the app's own heatmaps and pictures over 12 MB are skipped.
  - Add-on settings (which are on, provider, model names, Ollama address) stay on this device. An older app version ignores the picture text and does not know add-ons.
- **Audio and PDF boxes.** **Audio** and **PDF** in the toolbar add a clip or a document to the page; you can also drop files on the page. An audio box shows its name (from the file name) and length above the system's player. A PDF box shows one page at a time, fitted to the box's width, with previous / next buttons and a page count; it scrolls inside the box when the page is taller, and you move the box by dragging its name. Choose several files at once and each gets its own box. Files are kept in the same store as pictures, so they sync between devices, go in backups and are cleaned up when no page uses them. Up to 25 MB each; audio can be MP3, M4A, AAC, OGG, Opus, WAV, WebM or FLAC. Searching finds a clip or PDF by its name, and `has:audio` / `has:pdf` find pages that have one.
  - **Record** records straight into an audio box: click it, speak, click **Stop**; the clip's length is filled in when it's added. It is shown only where the window can use a microphone. **The Linux desktop app can't:** its window (WebKitGTK) refuses microphone access (checked on a real build), so there is no Record button there; add an audio file instead. It works in the browser preview (`npm run dev`); Windows, macOS and Android haven't been checked, so the button may appear there and fail with a message.
  - PDFs are drawn with pdf.js (loaded only when a PDF is opened). A password-protected or damaged PDF is refused with a message. Some rarely used image formats inside PDFs may not draw (the PDF decoder's extra modules aren't bundled; this hasn't been tested with such files). Selectable text in a PDF isn't available, and the text of a PDF isn't searched, only its name.
  - Exports: Markdown links the file (a page with audio or PDFs becomes a `.zip` with a `files/` folder next to `images/`); PNG and PDF export show an audio box as a bar with its name and a PDF as a labelled page, not the real first page. Library thumbnails do the same.
  - An older app version doesn't know these boxes: update both devices together before syncing a page that has them.
- **Sticky notes.** **Sticky** in the toolbar (or press **S** with nothing being typed into) drops a 200 × 200 coloured note: under the pointer if it's over the page, otherwise in the middle of what you can see. It's a small text editor with bold, italic and bullets, a slight shadow, and the same move, resize, layer, duplicate and undo as any box. Drag a sticky by its text to move it; double-click it (or select it and press Enter) to type. Long notes scroll inside the note. Pick one of 8 muted colours (or none) from the note's hover bar; the next sticky starts with the colour you last picked for one. Colours follow the light and dark theme and the text colour is chosen to stay readable. Markdown exports a sticky as a `> 📝` quote with its colour in a comment; PNG and PDF show the real colour.
- **Colour.** Every box has a colour button in its hover bar (8 muted colours, or none): a background tint for text, lists, code, tables and stickies, and a border for pictures. Frames take the same colours (their header text switches to dark or light to stay readable) and keep their original palette under **Classic colors**. In the library, a page card's menu has **Card color**, shown as a stripe down its left edge with a soft tint. Colours follow the light and dark theme, and one colour change is one undo step.
- **Drawing on the page.** **Draw** in the toolbar lets you draw anywhere on the page, among your text boxes, frames and pictures, with [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT licence): pen, shapes, arrows, text and eraser. The tools appear over the page with your boxes showing through; scroll or zoom inside it and the page moves with you. Press **Done** when finished. Edits are saved as you draw, and Excalidraw keeps its own undo while you're drawing. Ink sits above the boxes, never blocks clicking them, and stays where it is when you move a box (it belongs to the page, not to a box). Thumbnails, PNG and PDF exports include it, and Markdown exports save it as `images/drawing.svg` in the zip. Excalidraw is only downloaded into the app the first time you open draw mode, and its fonts are bundled, so drawing works offline. Chinese, Japanese and Korean text in a drawing uses your system font.
- **Export** any page from its header (**Export**) or from its card's menu:
  - **Markdown:** text, checklists, code, tables, audio and PDF links in reading order, with arrows listed under a **Connections** heading and each frame's contents nested under a heading named after it. Pages with pictures become a `.zip` holding the `.md` file and an `images/` folder.
  - **PDF:** one page, sized to your content and drawn exactly as on the canvas. It's a picture of the page, so its text isn't selectable. Use Markdown when you need the text.
  - **PNG:** a sharp image of the page at twice screen resolution.
- **Settings** (bottom of the sidebar), in six tabs:
  - **Profile:** a display name and colour, shown as an avatar at the top of the sidebar. It's local to the device; there are no accounts and nothing is sent anywhere.
  - **Appearance:** **Mode** (Match my system, Light or Dark) and a **Colour theme**: Default, six ready-made themes (Sepia, Rosé, Mint, Nord, Midnight, Forest) or **Custom**, where you pick a light or dark base and four colours (background, surface, text, accent) and everything else follows from them. A colour theme is light or dark by itself, and a warning appears if your text colour is hard to read. Themes are a setting of this device and are not synced. Exports are always light.
  - **Editor:** turn snapping to other boxes and the grid on or off (Alt still frees a single drag), and choose the daily-page template.
  - **Sync:** on the phone, turn automatic background syncing off (the Sync button still works); shortcut to the pairing and sync panel.
  - **Data:** **Back up all notes** saves every page, group and picture to one `.json` file; **Encrypted backup** does the same but locks the file with a passphrase you type twice (AES-256-GCM, key made with PBKDF2-SHA256 at 600,000 rounds, all on your device). The passphrase is never stored, so a lost one can't be recovered; **Restore from backup** asks for it when it opens an encrypted file. Only backup files are encrypted: the notes on your computer are not, so use your system's disk encryption for that; **Restore from backup** adds back anything you don't already have (existing pages are never overwritten, and pages in Trash aren't backed up). Also how long deleted pages stay in Trash: 7, 30 or 90 days, applied when the app starts.
  - **About:** version, where your notes are stored, and a keyboard shortcut list.
- **Icons.** Buttons, sidebar entries, settings tabs and palette commands carry a small icon (a gear for Settings, a calendar for Calendar, a clock for History and so on), drawn in the current text colour so they follow every theme.
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
    validate.ts            checks for ids and image types that arrive from a sync peer or backup file
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
  lib/widgets.ts           widget model: ids, sizes, reading what was saved (pure)
  widgets/                 pinning boxes/pages to the desktop: registry, shell bridge
  addons/                  optional add-ons (registry, store, ai/, ocr/), loaded only while switched on
  lib/llm/                 model providers: requests, stream parsing, addresses, transport (pure apart from transport.ts)
  lib/media.ts             audio and PDF files: kinds, limits, names, times (pure)
  lib/files.ts             which stored files a block uses (sync, backup and clean-up all ask here)
  lib/pdf.ts               PDF reading through pdf.js, loaded on first use
  lib/recorder.ts          microphone recording
  lib/search.ts            library search: words plus #tag, has:, in:, after:, before: (pure)
  lib/cards.ts             card logic: cover and details, search, tags, sets and board columns (pure)
  lib/browse.ts            what the Groups and Tags pages list, and their search
  store/
    notes/                 the notes store, one file per concern (state, init, save, mutate, blocks,
                           arrows, pages, groups, attendance); index.ts re-exports them all
    …                      undo history, canvas state, images, toasts/dialogs
  components/
    library/               Library (page list), Sidebar, Browse (Groups/Tags pages), PageCard,
                           TemplatesView, TrashView, EmptyState, thumbnails
    editor/                header, canvas (drag/resize/marquee/pan), block frame
    widget/                the contents of a desktop widget window
    editor/canvas/         canvas hooks: keyboard and paste, wheel/pinch zoom, empty-box cleanup
    blocks/                text (TipTap), checklist, code, table, image, audio, pdf
    sync/                  Sync panel
src-tauri/
  src/sync.rs              encrypted transport: LAN service (laptop) and client (phone)
  src/ai.rs                network side of the AI add-on: key file, destination allow-list, streaming proxy
  src/widgets.rs           widget windows, tray icon, background mode
  src/guard.rs             allowed peer addresses, replay protection, request cap (unit-tested)
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
