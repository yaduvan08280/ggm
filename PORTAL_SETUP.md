# GGM Portal — setup and go-live guide

The code for everything in `PORTAL_PLAN.html` is written in this folder. **Nothing has been pushed or deployed yet.**
Follow the steps in order. Until you do step 4 for an app, that app keeps working as it does today (see "What users notice" for the two small changes that apply straight away).

---

## 0. What changed (files)

| Folder | Files | What |
|---|---|---|
| `main hub app/` hub | `Code.js`, `Index.html` (+ `.clasp.json`, `.claspignore`: the plan file stays local) | New tabs (Settings, Sync, Lists, Badges, Import), user sync, badges, OTP reset + first-time set, Admin screen with the Portal-only switch, app login check, dashboards group |
| `portal_connector/` | `Portal.js` | Master copy of the shared connector (copied into every app, identical) |
| `indent_flow/` | `Portal.js`, `13_Portal.js` (new) · `03_Auth.js`, `08_Api.js`, `Scripts.html` | Launch pass, portal login, user sync (role/site), badge = "my queue". PIN change and user editing move to the portal once connected |
| `fuel_and_car_tasks/` | `Portal.js`, `PortalApp.js` (new) · `Auth.js`, `Code.js`, `Config.js`, `Index.html` | Launch pass, portal login, user sync (auth columns only), badge. **Fuel and service forms: "Filled by" = the signed-in user** (no Driver dropdown) |
| `assets/` | `Portal.js`, `PortalApp.js` (new) · `Code.js`, `Index.html` | Every server call needs a session; site comes from the session; people sign in as themselves; column B of Transfer/Receive = username |
| `Staff_Dashboard/` | `Portal.js`, `PortalApp.js` (new) · `Code.js`, `Index.html` | Every server call needs a session; the name comes from the session; new staff are added to the Doer List |
| `main_admin_dashboard/` | `Portal.js`, `PortalApp.js` (new) · `Code.js`, `Index.html` | Login (once connected), Given By = signed-in admin, "Assign to" = portal users with the Staff Dashboard, "done by" columns, report/email functions made server-only |
| `newai_checklist/` | `Portal.js`, `PortalApp.js` (new) · `Code.js`, `Helper.js`, `index.html` | Every server call needs a session; name + mobile come from the session (Newai Doer List row); portal login; badge; menu/dialog tools only from the sheet |
| `jaipur_checklist/` | `Portal.js`, `PortalApp.js` (new), `index.html` (restored from deployed version 35 — the page was missing from the latest code) · `Code.js`, `Helper.js` | Like Newai/Tonk: every page call needs a session; Role USER (own tasks, needs a Doer List name) or ADMIN (master panel); a user can only tick their own tasks; the built-in `Main` / `123456` login stops working once connected; menu tools only from the sheet |
| `tonk_checklist/` | `Portal.js`, `PortalApp.js` (new) · `Code.js`, `Helper.js`, `index.html` | Same as Newai; the portal Role (DRIVER / STAFF) picks the driver or staff screen; the built-in `Main` / `123456` login stops working once connected |

The three public dashboards (Mines, Collection, Levanto) are **not changed**.

---

## 1. Back up

For every spreadsheet the apps use: **File → Make a copy**. (Hub master sheet, Indent sheet, Fleet sheet, Assets + vehicle sheets, Delegated / Routine / Renewal sheets.)

## 2. Push the code (one folder at a time)

```bash
cd "C:\Users\Admin\Desktop\Main Dashboard\main hub app" && clasp push
```
Then the same inside each app folder (`indent_flow`, `fuel_and_car_tasks`, `assets`, `Staff_Dashboard`, `main_admin_dashboard`, `newai_checklist`, `tonk_checklist`, `jaipur_checklist`). `clasp status` shows exactly which files each folder pushes.

**After each push:** open that project → **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.**
Never use "New deployment" for an existing app: it creates a new `/exec` link and breaks bookmarks.

> Indent Flow already declares its scopes in `appsscript.json`; the others will ask for **one new permission** ("connect to an external service") the first time you run anything in the editor — accept it (it lets the app talk to the hub).

## 3. Set up the hub

1. Open the **master sheet** → reload → menu **Portal Admin → Set up / repair tabs** (accept the permissions).
   This adds the new columns and tabs, pre-fills the **Apps** tab (11 rows, dashboards already linked) if it was empty, and installs 4 triggers (edits, 1-minute sync, 5-minute badges, daily dropdowns).
2. First time only: **Deploy → New deployment → Web app** — *Execute as: Me*, *Who has access: Anyone*. Later: Manage deployments → New version.
3. **Apps tab:** paste each app's `/exec` link into **URL**. Check the rows:

| App ID | Type | Fields | Match By | Badges |
|---|---|---|---|---|
| INDENT | CONNECTED | `role,site` | Username | ✓ |
| FUEL | CONNECTED | *(blank)* | Email | ✓ |
| ASSETS | CONNECTED | `role,site` | Username | ✓ |
| STAFF | CONNECTED | `doer` | Doer name | ✓ |
| MAINADMIN | CONNECTED | *(blank)* | Username | ✓ |
| NEWAI_TASKS | CONNECTED | `doer` | Doer name | ✓ |
| TONK_TASKS | CONNECTED | `role,doer` | Doer name | ✓ |
| JAIPUR_TASKS | CONNECTED | `role,doer` | Doer name | ✓ (ADMIN needs no doer) |
| MINES / COLLECTION | LINK | | | |
| LEVANTO | LINK | | | ✓ |

   (If your Apps tab already had rows with other IDs, keep them, but the **App ID must match `PORTAL_APP_ID`** in step 4.)
4. **Users tab:** fill **Email** for everyone and tick **Portal Admin** for the people who may flip the switch.

## 4. Connect each app (repeat for the 8 apps)

1. In the **Apps** tab, click the app's row → **Portal Admin → Connect selected app**.
2. The dialog shows three values. Open that app's Apps Script project → **Project Settings → Script properties → Add**:
   `PORTAL_SECRET`, `PORTAL_APP_ID`, `PORTAL_HUB_URL` — paste them exactly.
3. Back in the sheet: **Portal Admin → Test connection to selected app** → "Connected".

From this moment that app: opens already signed in from a portal tile; its own login screen asks for the **portal** username/phone + password; its old passwords and site logins stop working.
(Main Admin only: optional property `PORTAL_STAFF_APP_ID`. Without it Main Admin asks the hub for `STAFF DASHBOARD`, then `STAFF`. Asking only for `STAFF` used to fail quietly, so "Assign to" fell back to the old Delegated Doer List and was missing names.)

## 5. Fill the dropdowns and bring people in

1. **Portal Admin → Refresh dropdowns from apps** → the Access grid gets Role / Site / Doer name dropdowns.
2. **Portal Admin → Import existing users from apps (one-time)** → the **Import** tab lists everyone the apps already know, with a suggested hub username.
   - Add people to **Users**.
   - Where someone's id inside an app is different from their hub username, add a row to **App Logins** (Username, App ID, Local Username). This matters most for **Indent** (keeps their old User ID and indents) and **Fuel** (their old login email).
3. **Access tab:** tick apps, pick Role / Site / Doer name. Red cells = something required is missing (that row will not sync).
4. **Portal Admin → Sync now** → check the **Sync** tab (✓ OK / ✗ with the app's message). After that it runs by itself every minute.
5. Select rows in **Users** → **Portal Admin → Send set-password email to selected user(s)**. People open the portal → **First time here?** → get a code by email → choose a password. (People without email: type a temporary password in **Set Password**; it is hashed and wiped at once.)

## 6. Badges

Automatic every 5 minutes (and refreshed when someone closes an app). Errors show in the hidden **Badges** tab.

**Levanto:** run **Portal Admin → Test Levanto badge**. It shows the columns of the `Grade Alerts` tab and which ones it used. If the guess is wrong, type the exact headers into **Settings**:
`LEVANTO_OPEN_HEADER` (the column that is empty while an alert is unanswered — or set `LEVANTO_OPEN_VALUE` to the value that means "open"), `LEVANTO_TIME_HEADER` (when it was raised), `LEVANTO_WINDOW_HOURS` (3).

## 7. Indent Telegram buttons

In Indent Flow → Settings, set **APP_URL** to `<hub /exec link>?app=INDENT`, so notification buttons open through the portal.

## 8. Go portal-only

Run a week with the switch **OFF** (both the portal and the apps' own links work, same password).
Then a Portal Admin opens the portal → avatar → **⚙️ Admin: Portal-only switch** → ON → confirm. The screen shows ✓ per app; an app that did not answer is retried every minute.

**Emergency** (hub broken while ON): in any app's Script properties set `PORTAL_ONLY` = `false` — that app opens with its own link again.

---

## What users notice

**As soon as the code is pushed (before connecting):**
- **Fuel:** the fuel and service forms no longer ask for the driver — "Filled by" is the signed-in person.
- **Assets and Staff Dashboard:** everyone is asked to log in **once** more (their browser gets a proper session), and again after **6 hours without using the app**. Assets site users can now only act for their own site on the server too.
- **Newai, Tonk and Jaipur checklists:** everyone is asked to log in once more (and again after 6 hours without use), for the same reason.
- Indent Flow and Main Admin Dashboard: no change yet.

**After an app is connected (step 4):** everyone signed in to it is signed out once; its login screen then asks for the GGM Portal username/phone and password; tiles open it with no login.

**Setup and maintenance functions** (Indent `setupSystem` / `resetPin` / `installTriggers`, Fuel `installTriggers` / `adminLogoutAllSessions`, Assets `activateLiveSystem`, the checklists' menu tools…) now run only from the Apps Script editor or the sheet menu. Before, anyone with an app link could call them from a browser — e.g. Indent's `resetPin` could set any admin's PIN.

**After Portal-only ON:** the apps' own links show "Open through GGM Portal".

---

## Checked before handing over

- All `.js` files and every page script pass a syntax check.
- The hub's signed tokens and the connector's reader were tested against each other (12 tests: both directions, wrong secret, tampering, expiry, Access grid parsing old and new layout).
- The data given to each page cannot break out of its `<script>` tag (tested).
- The hub page was previewed with sample data: home with badges and dashboards group, Admin screen and switch with confirmation, forgot-password steps.
- `clasp status` in every folder lists only that folder's own files.
- Self-checks you can re-run after any edit, from any folder: `node portal_connector/checks/all.js` (runs all eight and prints one line each).

**Not testable from here** (needs the live Google projects): the actual pushes, permissions, triggers, emails and reading your real sheets. Do steps 3–5 with one test user first.

## Known limits

**Capacity ceilings (fine at today's size; watch them as users grow):**
- Every app runs as `itadmin@`, so all users' requests share Google's limit of ~30 scripts running at once for that account. Badges and sync add to it; if users see "too many simultaneous invocations", raise the badge interval.
- Portal triggers (1-minute sync + 5-minute badges) use trigger runtime from the account's 6 h/day; the sync does no writes and no app calls when nothing changed.
- App sessions for Assets / Staff / Main Admin / Newai / Tonk live in Google's cache; Google may drop cache entries early, which just means signing in again (or reopening the tile).
- The trigger functions (`portalMinuteJob`, `portalBadgeJob`, `portalDailyJob`) can be started by anyone who has the hub link; they only re-run the sync, so the cost is quota, not data.

- The 3 dashboards stay **public links** (your choice): the portal only decides who sees the tile.
- The Staff Dashboard still finds tasks by name matching (now fed the exact Doer List name); it does not check that a task id belongs to the person marking it — same as before.
- "Done by" columns in the Main Admin sheets are written only where the header cell is empty or already has that label (see `MA_COLS` in `main_admin_dashboard/PortalApp.js`); if a column is already used for something else, it is skipped and logged instead of overwritten.
- The Levanto badge rule is read from its sheet by column name; confirm it with **Test Levanto badge**.
- **Newai / Tonk checklists:** a person must already be a row in that site's routine **Doer List** (name, department, email, mobile) — tasks are generated from it, so the portal does not add rows there; the Sync tab says so if someone is missing. Their doer-name dropdown comes from that list.
- **Tonk:** "Sync & Generate" (`drv_createChecklist`) and the reminder/rollover jobs stay callable by the page's visitors because they may run as timed triggers; only the menu items are locked to sheet users. Its Assign Buddy dialog calls `getAssignBuddyOptions` / `assignBuddyToTasks`, which do not exist in the Tonk code (it fails today, unchanged).
- **Delegated Master "transfer to":** the Newai and Tonk checklists keep it in column **S**, the Staff Dashboard in column **R** — a transfer requested in one app is not seen in the other. This was already so; not changed.

---

# v2 login: apps move one at a time

**Why:** in v1 the hub pushes users to each app over the web every minute, and every app keeps its own user list. In v2 the hub writes a tab **`Portal Users <APP ID>`** straight into the app's own spreadsheet the moment you tick or untick someone. The app signs people in from that tab, with no web calls, so it works even when the hub is down.

**How it works**
- You tick an app for someone in **Access**. Within seconds the hub writes their row (username, name, phone, email, role, site, doer, password hash) into that app's tab.
- Unticking, or switching the person off in **Users**, removes the row, and they are signed out within 20 seconds.
- Changing a password in the portal also reaches every v2 app at once.
- Every row carries a signature (**Check**). A row typed or edited by hand is ignored, and the tab is protected so only itadmin@ can edit it.
- Old user tabs and old data in the app are never read, changed or deleted.
- Every v2 app uses the same key, **PORTAL_KEY**, which equals the hub's PEPPER. There's one value to paste per app, once.
- The minute job repairs any missed write. The 06:00 job rewrites every tab, which brings back a deleted tab.

**Order:** Task Delegation ✅ (done in code) → Renewal → checklists → Staff Dashboard → Indent Flow → Fuel & Car → the rest. Apps not moved yet keep working on v1 exactly as before.

## Phase 1: Task Delegation

What changed in `task delegation/`:
- **`GgmLogin.js` (new):** the shared login. Master copy: `portal_connector/GgmLogin.js`.
- **`PortalApp.js` (new):**
  - App ID `DELEGATION` and the Delegated sheet ID.
  - The badge: follow-ups due by tomorrow.
  - The "who did what" stamps in Master U–X: Created By · Last Action · Last Action By · Last Action At. These are the same columns Main Admin uses.
- **Server:**
  - Every page function now needs a sign-in.
  - Given By (Master K) = portal username. It used to be the Google email, which was blank for most people.
  - Adding or revising tasks takes a lock, so two people can't get the same TK number.
  - The duplicate `doGet` and view loaders were removed. The page you used, `main.html`, is still the one served.
- **Page:**
  - A sign-in card (portal username or phone + password).
  - Your name and a Sign out button in the top bar.
  - "Done (verified by whom)" starts filled with your name, and you can still change it.
- **Sheet:** a new tab **`Portal Users DELEGATION`** appears in the Delegated sheet. Nothing else in Master, Doer List or Leave changes.

Steps (about 10 minutes):
1. **Hub.** In `main hub app`, run `clasp push`.
   - Open the portal sheet → **Portal Admin → Set up / repair tabs**. This adds the **Sheet ID** column to Apps, a **DELEGATION** row, and its tick column in Access.
   - Then Apps Script → **Deploy → Manage deployments → Edit (the existing one) → New version**. The live portal is still the very first version until you do this.
2. **Apps tab, DELEGATION row.** Paste Task Delegation's **/exec** link (the one people use) into **URL**. Sheet ID is already filled with the Delegated sheet.
3. **Access tab.** Tick **DELEGATION** for everyone who uses Task Delegation, for example the five "Done by" people.
   - The tab `Portal Users DELEGATION` appears in the Delegated sheet straight away.
   - The Access **SYNC** column shows ✓, and the Sync tab says `in Portal Users DELEGATION`.
4. **Key.** Click the DELEGATION row in Apps → **Portal Admin → Connect selected app (show its key)** → copy it.
   - In the Task Delegation script: **Project Settings → Script properties → add `PORTAL_KEY`**, then paste.
5. **Task Delegation code.** In `task delegation`, run `clasp push`, then **Manage deployments → Edit (the deployment in use) → New version**.
6. **Test.**
   - **Portal Admin → Test connection to selected app** should say "People it can see: N".
   - Open the tile from the portal: it should open signed in.
   - Open Task Delegation's own link: you should see the sign-in card.
   - Untick someone: within 20 seconds their next click shows the sign-in card.

**If something goes wrong:** Manage deployments → Edit → pick the previous version of Task Delegation. Nothing in the sheet needs undoing. The new tab and the U–X stamps can stay.

**Checks:** `node portal_connector/checks/all.js` (file `v2.js`, 39 checks). These cover:
- The hub and app produce the same password hash.
- Signed rows work; hand-edited rows are refused.
- Unticking someone ends their sign-in, and so does a password change.
- Tile passes, badge requests and replay refusal.
- The page's token handling.

## Deployed on 7 Oct 2026

Each app was pushed, then its existing deployment was edited to a new version (pencil → New version), so every link stayed the same. Live check: each page loads, and each portal handler refuses an unsigned request.

| App | Deployment (description → version) | Note |
|---|---|---|
| Hub | `AKfycbyWO02y…` main app 1 → v5 | |
| Indent Flow | `AKfycbzOGKuU…` (was "version 14") and `AKfycbyUD3AE…` (was "test version 7"): main app 1 → v21 | both links now run the same code |
| Fuel & Car | `AKfycbzF-oYM…` main app 2 → v43 | |
| Assets | `AKfycbyTIbox…` main app 3 → v65 | diagnostic message removed again, as asked |
| Staff Dashboard | `AKfycbxV_Qxg…` main app 2 → v85 | includes the Week Shifted and Doer List fixes |
| Main Admin | `AKfycbyZTlTZ…` main app 2 → v69 | |
| Newai | `AKfycbyw4VOx…` main app 2 → v47 | |
| Tonk | `AKfycbzeMY4I…` main app 2 → v19 | |
| Jaipur | `AKfycbztJjkg…` main app 3 → v38 | |
| Task Delegation | `AKfycbyFA9WQLK42i_OtuFna9o17aZDF0j0AQpq2FQjc7S_Ipiz20GAs6MTWw9piej39Qonw` main app 1 → v59 | v2 login. This reuses an old unnamed deployment, because the 20-deployment limit was reached. The other 22 old Task Delegation links still run the old code, which has no login. |
| Renewal | not deployed | no web app, and no users needed. Staff Dashboard entries land in its Task Feed as before. |

## Tile icons and colours (Apps tab)

**Icon (column C):** type one of these names. Each draws a clean line icon that looks the same on every phone. An emoji or an `https://` image link also works. A picture pasted into the cell is ignored.

`cart` · `truck` · `fuel` · `checklist` · `list` · `calendar` · `tasks` · `shield` · `send` · `chart` · `factory` · `wallet` · `mine` · `box` · `users` · `doc` · `tools`

**Color (column D):** a hex colour such as `#2563EB`. The tile shows a soft tint of it, and in dark mode it is lightened automatically.

Set on 7 Oct 2026:

| App | Icon | Colour |
|---|---|---|
| Purchase & Stock | cart | #2563EB |
| Assets | truck | #C2410C |
| Fuel & Car | fuel | #0284C7 |
| Checklist App (Staff) | tasks | #16A34A |
| Main Admin | shield | #7C3AED |
| Task Delegation | send | #0D9488 |
| Jaipur Checklist | checklist | #BE185D |
| Newai Checklist | list | #4F46E5 |
| Tonk Checklist | calendar | #CA8A04 |

**Order (column G):** 1–9 in the table's order, so related apps sit together.

## No duplicate people (Users tab)

Username, Phone and Email must each belong to one person. Phones are compared by their last 10 digits, so `98290 12345` and `+91-9829012345` count as the same number.

1. **Typing:** the sheet refuses a duplicate with a message. These rules are on Users columns A, C and J; they were switched on automatically and are re-applied every day at 06:00.
2. **Pasting:** a paste can get past a sheet rule, so the portal's edit check undoes or clears the duplicate cell. It shows a note naming the row that already has it, and writes a line in the Log (DUPLICATE_BLOCKED).
3. **Red cells:** any duplicate that exists anyway is painted red.
4. **Sign-in:** a username, phone or email that matches two rows is refused with "belongs to more than one person… ask the IT admin" (Log: LOGIN_AMBIGUOUS), instead of guessing.

**Menu:** Portal Admin → **Check for duplicate users** switches the rules on and lists any duplicates.

**Clean-up on 7 Oct 2026:** 10 unused imported rows were deleted from Users: DEEPAK SHARMA, PRASHANT PAREEK, the second SONU, VINOD OLA, LALA RAM ×2, SHOJI RAM JI, HEMRAJ JI, JAWED KHAN, ISLAM KHAN. Each was a second copy of a person who already had a short-username account with Purchase access. None had apps ticked or had ever signed in. 70 people remain, with no duplicates.

Checks: `portal_connector/checks/dup.js` (14).

## Give access as the apps have it (Portal Admin menu)

1. **Portal Admin → Import existing users from apps** lists every person each app already has (Import tab).
2. **Portal Admin → Give access as the apps have it (from Import)** then updates the Access grid:
   - It ticks each matched person's apps, matched by phone, email or exact name. It also matches by username when the app has no real phone.
   - It fills an empty Role, Site or Doer name from the app's own data.
   - It **only adds**: it never unticks anything and never changes a choice already made.
   - Values that aren't in a Role or Site dropdown are skipped and reported. A single invalid cell makes Google refuse the whole write.
   - People who aren't in Users are listed, so you can add them and run it again.

**Run on 7 Oct 2026:** 86 app ticks and 133 cells were set; the Access tab now holds 115 ticks. Everyone synced OK: Jaipur 17, Newai 8, Staff 35, Tonk 31, Purchase 12, Fuel 3, Assets 4, Main Admin 5, Task Delegation 5.

Not linked, because they have no portal account:
- Newai: AKBAR ALI, DINESH, KHUSHIRAM GURJAR, SUNIL KUMAR, HARKESH GURJAR, GOVIND SINGH, CHANDAN SHRIVASTAV, and a second PRASHANT (8104111191).
- Staff: "JPR - VIPIN - 9202827238".

Checks: `portal_connector/checks/import.js` (7).

## Both logins while you test (live 8 Oct 2026)

While **Portal-only is OFF**, every app's own link accepts the GGM Portal username + password **and** the app's old login. The portal is tried first.

| App | Old login | Published as |
|---|---|---|
| Purchase & Stock | User ID + PIN (Change PIN / Add user work again) | main app 2 (both links) |
| Fuel & Car | email + password (own Forgot / Change password work again) | main app 3 |
| Assets | site name + password | main app 4 |
| Staff Dashboard | mobile + password (Delegated → Users tab) | main app 3 |
| Newai / Tonk / Jaipur | mobile + password (their Doer List) | main app 3 / 3 / 4 |
| Main Admin | (never had its own) portal login only | main app 3 |

**Portal-only ON** (portal → account menu → Admin) ends every old sign-in at once, and from then on only portal logins work. The shared `Main` / `123456` login in Tonk and Jaipur stays closed while they are connected.

Checks: `portal_connector/checks/dual.js` (20).

## Designations, Sheets, Forms and the bottom menu (live 8 Oct 2026, hub "main app 9")

**Tabs in the Master App sheet**
- **Designations**: type a designation in column A, then tick its apps and pick the **Role** for each (the app columns build themselves from Apps).
- **Users → Designation** (column N): a dropdown of those designations.
- **Sheets** / **Forms**: type the **Name** (what people see), the **Link**, the **Site**, and optionally a **Designation**. Then tick the users who get it (one column per user, built from Users).
- **Designation Links**: rows are your designations and columns are your sheet and form names. Tick = everyone with that designation gets it.

**What happens automatically**
- **Choosing a designation for someone** ticks that designation's apps (with roles), sheets and forms. Changing their designation removes only what the old designation gave; anything ticked by hand stays.
- **Ticking or unticking in Designations or Designation Links** applies to everyone who has that designation now. A cleared role never clears people's roles.
- **Site and Doer name stay personal:** set them in Access as before.
- **Everything stays editable by hand afterwards.**

**Menu**
- Portal Admin → **Build / repair Designations, Sheets & Forms tabs**
- Portal Admin → **Apply designations to everyone (adds only)**

**Portal**
- A bottom menu: **Dashboards · Sheets · Forms**, each with a count. It shows only what that person is ticked for. Tapping the same menu again, or **← Apps**, goes back.
- Links aren't sent to the phone: on a tap the portal checks the tick, then opens the link in a new tab.
- Dashboards are Apps rows with Type **LINK**. Sheets and forms still need normal Google sharing for the person to open them.

Checks: `portal_connector/checks/desig.js` (19).

### Dashboards added (12 Oct 2026, hub "main app 11")
Mines, Collection and Levanto Production (links from moredashboards.txt) are in the Apps tab rows 11-13, Type LINK, icons mine / wallet / factory. Set up / repair now adds any missing default dashboard, under the last app row. Tick a person under MINES / COLLECTION / LEVANTO in Access (or in Designations) and it shows in their Dashboards menu.

### Bottom menu: Apps button (12 Oct 2026, hub "main app 12")
The bottom menu is now Apps · Dashboards · Sheets · Forms. Apps shows the app tiles; the old "<- Apps" back button is gone. The menu still appears only for people who have at least one dashboard, sheet or form.

### Dashboards open inside the portal (12 Oct 2026, hub "main app 13")
Mines, Collection and Levanto open in the portal viewer (same X bar as apps), not a new tab. All three allow being framed (tested). A future LINK dashboard that refuses framing would show a blank viewer; its owner must set XFrameOptionsMode.ALLOWALL in its doGet.

### Dashboards open instantly (12 Oct 2026, hub "main app 14")
Dashboard (LINK) URLs now come with the home list (public links only; app links never do), so opening needs no server call. After the home screen shows, the portal loads the person's dashboards one by one in the background (hidden) and keeps them after X; reopening is instant. A dashboard kept more than 15 min reloads when opened. Switches at the top of the Index.html script: PRELOAD_DASHBOARDS, DASH_STALE_MS.

### Apps open faster too (12 Oct 2026, hub "main app 15")
KEEP_ALIVE = 3: the last 3 opened apps stay loaded after X (reopen instant; older than 15 min opens fresh). PRELOAD_APPS = 1: each phone remembers which app the person opens most and loads it in the background after the home screen shows (Log shows OPEN ... "preloaded"). Apps are not all pre-loaded: each open needs a one-time pass and would multiply load on the live apps.

### Indent Flow: who works each step, step 7 renamed, speed (16 Oct 2026, "main app 4", version 24)
- Settings > "Who works it": tap STORE / PURCHASE / PC per step (steps 2-9). Saved in the Settings tab as STAGE_ROLES_JSON. The server checks it on every step action, the "Take action" button follows it, and step notifications go to whoever owns the next step. Admin can always act; steps 1 and 10 are fixed.
- Step 7 is now "Receive & Check Jaipur" (Hindi added). Route labels such as "Receive & Check at Hub - X" still name the actual place.
- Speed: one sheet read per tab (was two); Users/Settings/Sites/Sections/Vendors cached between requests (any app write refreshes at once, hand edits in the sheet within 2 min, a row moved by hand blocks the write instead of hitting the wrong row); an indent's step rows found by search instead of reading all of Stage_Timings; Telegram sent after the write lock; sign-ins no longer reload every open screen; stock sweep 11.6 s -> ~3 s and no longer reloads screens; reorder count cached until stock changes; first screen loads menus and dashboard together and shows the last dashboard instantly; reopening an unchanged indent is instant.
- Checks: portal_connector/checks/indent_speed.js (43).

### Lost features restored (17 Oct 2026)
- Assets ("main app 6", v68): transfers now show "in transit" and can be received (the latest transfer/receipt decides where an asset is; restored from v61). Server refuses dispatching an asset already moving or not at that site, and receiving at a site it was not sent to. Photos shrink to 1024px before upload again (v61). Vehicle details cached 10 min (dashboard refresh ~6-7 s -> ~3-4 s).
- Indent Flow ("main app 6", v26): every stock movement in/out is written to the site's IMS sheet again (restored from v19), after the write lock.
- Cause: the first GGM Portal versions (Assets v62, Indent v20) were pushed from local copies older than the latest versions. Audit of Fuel, Staff, Newai, Tonk, Jaipur, Main Admin, Task Delegation found nothing else lost.
- Checks: portal_connector/checks/assets.js (19), indent_speed.js (54).

### Safe deploys (17 Oct 2026) - use this for every Apps Script push
    python portal_connector/safe_push.py <app folder> "main app N" <deploymentId> [<deploymentId> ...]
Pulls HEAD and the newest saved version, refuses if any file/function would be lost, lists every code line that would disappear and refuses until acknowledged with --ack <code>, runs all checks, then pushes / versions / redeploys (same URLs). Proven: it would have stopped both October losses.

### Indent Flow IMS push switched off (17 Oct 2026, "main app 7", v27)
The IMS sheets are filled by hand by the store teams (no row ever came from Indent Flow), so the push stays OFF: Settings tab IMS_PUSH_ENABLED = FALSE. Code kept; set TRUE to turn on (then stop hand entry). Nothing was written to the IMS sheets. Note: the SANWARIYA IMS id in pushToExternalIMS_ looks mistyped (45 characters, does not open).

### Assets: Own vehicles / Contractors, phone layout (17 Oct 2026, "main app 7", v69)
- Add asset asks "Own vehicle" or "Contractor". Contractor -> Contractors section (columns O-T, same rows as each site block, no Misc). Own -> C-I as before.
- The sync now reads and writes both sections; the "Asset Owners" tab remembers which vehicles are contractor-owned, so transfers, receipts and cancels land them back in the Contractors section. A block with more vehicles than rows is left untouched (logged) instead of dropping names.
- Top right: Dispatch, Receive, Add (+). Reload is a floating button bottom-left. Phone: bottom-sheet forms, 16px inputs, compact fleet cards, owner chip + owner filter.

### Assets: Remove asset, admin / boss only (17 Oct 2026, "main app 8", v70)
Asset detail panel -> "Remove asset" (shown only to BOSS/ADMIN/MAIN sign-ins, only for vehicles at base). A reason is required. The name is cleared from its site's Own or Contractors column and logged in the "Removed Assets" tab (when, asset, category, owner, site, who, reason). The server refuses anyone else and anything in transit. Transfers/receipts from before a removal are ignored, so re-adding the same name later starts fresh. To undo: add the vehicle again with Add asset.

## Fuel & Car: total KM, driver tiles and driver history (21 Oct 2026)

- **Data (Excel) tab**: new **Total KM** column = the odometer reading entered with each fuel / service form, for every vehicle at once (no vehicle dropdown needed).
- **Dashboard vehicle tiles**: the vehicle's current KM (highest odometer reading in its fuel and service entries) under the name.
- **Driver tiles** (under the vehicle tiles): one per driver, showing tasks marked done this month. Tap one for the driver's history: this month / all tasks / fuel entries / services, a month picker, the latest fuel entry, every service form, and a log book of tasks by date (car, task, time, late flag).
- **Where the history comes from**: the Checklist calendar (every "NAME (time)" cell is a completion; ❌ and ⏭ are not). Nothing new is written to the sheet. `History.js` reads it; the result is cached 15 min and dropped on every Checklist write, so a completion shows at once.
- **Speed**: the 60-second refresh carries only this month's completions; the full log loads (`apiTaskHistory`) when a driver tile is opened, then stays for 5 min.
- **Names**: "GAJENDRA" in an old fuel row, the username "gajendra" and "Gajendra Meena" in the Checklist are one person (matched by full name / username, or by first name when only one person has it). Driver tiles = only accounts whose ROLE (Users tab) is DRIVER (changed 21 Oct on request); disabled drivers show only if they have entries.
- Check: `portal_connector/checks/fuel_history.js` (16 checks).

## Profile photos (21 Oct 2026)

- **Add / change / remove**: GGM Portal → account button (top right) → **Add profile photo**. The phone crops and shrinks the picture first: a 112 px square for avatars and a sharp copy (≤ 560 px) for the full view, each small enough for one sheet cell. Stored in the hidden **Photos** tab of the Master App sheet (`main hub app/Photos.js`); every save bumps `PHOTOS_VER`.
- **Everywhere else**: the shared `Portal.js` (all 8 connected apps) injects a small page script with `window.PORTAL`. It fetches the photo list from the hub over the signed app channel (`portalPhotos` → hub op `photos`, cached 5 min on the app server and 3 min in the phone), and puts the photo into any element marked `data-ggm-photo="<username or name>"` (`"@me"` = the signed-in person, `"a|b"` = try a then b). People are matched by portal username, name, doer names and app logins. A photo shows in the apps within a few minutes of saving.
- **Tap a photo** → full size in the middle of the screen (`portalPhoto` fetches the sharp copy). Avatars that open a menu carry `data-ggm-zoom="off"` (Fuel's user chip, Indent's user chip); their account panels have a big photo that does zoom.
- **Marked so far**: Fuel (user chip, account panel, driver tiles + history), Indent (chip + account menu), Assets (signed-in card), Main Admin (every staff avatar), Staff / Newai / Tonk / Jaipur (signed-in avatar). Not yet: Task Delegation (v2 login, no Portal.js).
- `safe_push.py` now refuses to version a push when a local .js/.gs file did not reach Apps Script (the hub's `.claspignore` allow-list first left out Photos.js; fixed, Photos.js is listed there now).
- Main Admin's editor copy had an undeployed `transferTask` (+ safer attachment handling) — merged into the local copy and shipped with this change; the report functions stay private (`manualSendEmail_` / `manualDownloadPDF_`).
- Checks: `portal_connector/checks/photos.js` (19) and the updated `inject.js`.

## Hub sign-in lasts 1 week (21 Oct 2026)

- `PORTAL_CFG.SESSION_HOURS` 12 → 168. Phones signed in before this keep their old 12-hour expiry; every sign-in from now lasts 7 days. Changing the password still signs other phones out. The apps' own sessions (opened from the portal) are unchanged.

## Why photos did not reach the apps — and the app→hub channel fixes (22 Oct 2026)

Found from the Apps Script execution logs (every app's `portalPhotos` = Failed; the hub saw no request):
1. **Wrong hub address in every app.** `PORTAL_HUB_URL` was `…/a/ggminerals.com/macros/s/AKfycbzF8i2SCW…/exec` (the editor's test address, 404 for everyone else) because "Connect selected app" used `ScriptApp.getService().getUrl()`. Also broke the apps' "Go to portal" button, in-app sign-in with the portal password, and the link in **invite emails** / "Show portal link".
   - Fixed: hub `hubUrl_()` (Settings → `HUB_URL`, default = the live "main app" link) is used for the connect dialog, invites and the link menu; every signed hub→app request now carries `hub`, and `portalLearnHubUrl_()` in Portal.js saves it — a stale address heals at the next 5-minute badge job. Jaipur and Newai (not contacted by the jobs) were set by hand.
2. **App IDs with spaces were refused.** The hub's doPost stripped spaces (`MAIN ADMIN` → `MAINADMIN`) and found no secret. Now spaces are kept (affects MAIN ADMIN, STAFF DASHBOARD, the three CHECKLIST apps).
3. **Missing permission** "connect to an external service" (`script.external_request`) in apps whose manifest has no explicit scopes — the owner must approve it once per app (editor → run `portalPhotos` → Review permissions). Needed in: **Fuel, Assets, Jaipur, Tonk**. Already fine: Main Admin, Staff, Indent, Newai.

Separate, unrelated: Jaipur has leftover time triggers for `updateMonthlyMasterBackground` and `autoSync`, functions that no longer exist in its code — they fail twice a minute (harmless noise; delete those triggers in Jaipur → Triggers).

## Photos everywhere — finished (22 Oct 2026)

- All 4 pending apps approved `script.external_request` (Fuel, Assets, Jaipur, Tonk); `portalPhotos` now completes in all 8 Portal.js apps. Verified live: Main Admin score card, Fuel user chip.
- **Task Delegation (v2 login)**: the hub's minute job writes the hidden, protected tab **"Portal Photos DELEGATION"** in the Delegated sheet (Username · Name · Other names · Thumb · Photo, F1 = version) only when photos change (`syncPhotoTabs_` in hub Photos.js, property `PHOTO_TAB_<ID>`). `GgmLogin.js` now has `portalPhotos` / `portalPhoto` that read that tab and injects the same page script (an exact copy of Portal.js's `portalPhotoKit_`, enforced by the photos check). Any app moved to the v2 login gets this automatically.
- Delegation page: round photo next to your name in the header and next to each doer in the Follow Up / All Pending tables (initials when no photo; names like "JPR - ABHISHEK KUMAWAT (ACCOUNTS)" are matched as "ABHISHEK KUMAWAT", same rule as Main Admin).
- Deployed: hub "main app 22", Task Delegation "main app 3". Check: `photos.js` (33).

## Attachments up to 50 MB (22 Oct 2026)

| App | Before | Now |
|---|---|---|
| Main Admin (new task) | 3 MB per file | 50 MB |
| Staff (task done, renewal file) / Newai / Tonk | 8 MB | 50 MB |
| Indent (photo fields) | 15 MB | 50 MB (still shrunk in the phone) |
| Fuel, Assets, hub profile photo | no cap (shrunk in the phone) | unchanged |
| Jaipur, Task Delegation | no uploads | — |

- Photos are still shrunk in the browser, so a 50 MB photo travels as a few hundred KB.
- Files over 5 MB (documents, or a photo that cannot be shrunk) go straight to Drive in 8 MB pieces: `portal_connector/BigUpload.js` (master; copies in Main Admin, Staff, Newai, Tonk — the bigupload check enforces identical copies). A single google.script.run call carries ~50 MB and a file as text is a third larger, so one-call uploads could not reach 50 MB.
  - `bigUploadStart` / `bigUploadChunk` need a portal sign-in (`portalCheck_`); pieces must arrive in order and only the same person can continue an upload.
  - The page then sends `{ filename, mimeType, fileId }`; the app's save code calls `bigUploadTake_(f, folder)`, which accepts only ids its own upload just created (so nobody can attach — and make public — an existing private Drive file), moves the file to the same folder as before (e.g. Staff renewals) and shares it like other attachments.
  - Kept out of Portal.js on purpose: Drive code there would add the Drive permission to apps that do not use Drive (e.g. Jaipur) and stop them until re-approved.
- Deployed: Main Admin "main app 6", Staff "main app 6", Newai "main app 6", Tonk "main app 6", Indent "main app 10". Check: `bigupload.js` (23).

## Main Admin: transfer a task + files at review (28 Oct 2026, Nakul's tasks)

- **Transfer** (task detail → Transfer, only on open tasks: pending / overdue / rejected): pick the new person, optional new due date (left unchanged = same date), reason (required). Server `transferTask`: refuses finished, in-review, week-shifted/cancelled tasks and a transfer to the same person; sets the doer, status back to Pending, appends "Transferred from A to B on <date> | Reason: …" to column Q, clears column R (a transfer the staff member asked for in Staff Dashboard), stamps Last Action. Staff Dashboard shows it within 60 s (its cache).
- Task detail now shows column Q as **History / Notes**.
- **In Review** cards show the task's own files (**Task File n**, blue) and the files attached when it was marked Done (**Done File n**, green, column P — written there by Staff, Newai and Tonk alike), or "No file attached when marked Done". Detail labels: "Files given with the task" / "Files attached when marked Done".
- Check: `transfer.js` (15). Deploy as Main Admin "main app 7".

## English / Hindi switch (28 Oct 2026)

- **Hub**: "हिं / EN" button in the top bar and on the sign-in screen, plus Account menu → Language. The choice is saved in the new Users column **O "Language"** (Hindi / English; `setLanguage`), so it follows the person to every phone. A choice made on the sign-in screen is saved right after sign-in. The hub's own screens use a curated phrase list (Index.html `HI` / `HI_RX`); a translator swaps exact phrases on screen and restores English exactly. Apps kept open in the background are dropped on a switch so the next open uses the new language.
- **Apps**: the language rides in every launch pass (claim `lg`) → `PORTAL.boot.lang` (Portal.js; `PORTAL_CFG.boot.lang` in GgmLogin.js). The injected `portalLangKit_` remembers it per app (`localStorage ggm_lang`) and applies it:
  - app with its own Hindi defines `window.ggmApplyLang(lang)`: **Fuel** (toggleLanguage), **Indent** (setLang at sign-in, portal choice wins over its own saved one), **Newai** (newaiTasksLang), **Main Admin** (its Google translate switch);
  - every other app (**Staff, Assets, Jaipur, Tonk, Task Delegation**) is translated to Hindi by Google's page translator (banner hidden). Machine translation: mostly right, a few odd words (e.g. "Leaves" → "पत्तियों").
- Jaipur's editor copy had a new spreadsheet menu tool **"🗑️ Delete Deleted Tasks"** (`purgeDeletedTasksFast`) — kept and shipped as-is.
- Deployed: hub "main app 23"; Staff 7, Assets 11, Tonk 7, Jaipur 7, Fuel 9, Indent 11, Main Admin 8, Newai 7, Task Delegation 4. Check: `lang.js` (22).

## Assets: every site in its own columns (30 Oct 2026)
"Present Assets List" stacked the sites as row blocks (TONK 4-21, SANWARIYA 25-39 ...), so a site
with more vehicles than its rows broke: "No empty slot", the sync skipped that site, and the FOR FORMS
formulas spilled into the next site. It is replaced by three tabs, each site a band of columns
(row 2 site, row 3 category, vehicles from row 4 down, no row limit):
- **Owned By Us** - own vehicles (7 categories) + Asset In Transfer / Transferred Location
- **Contractor Vehicles** - contractor vehicles (6 categories)
- **For Forms** - `=IFERROR(UNIQUE(FILTER({own;contractor})))` per category; MISC. (orange) is typed by hand
The Assets app finds columns by these headings (`readSiteTab_` in assets/Code.js), so adding a
site = a new band in all three tabs + the name in `LOCATION_BLOCKS`. Moved by `migrateToSiteColumns`
(assets/Migrate.js): 99 names, 0 mismatches; old tab deleted after nothing read it.
Also changed: the TONK / SANWARIYA / KHAKHUNDA report tabs now read their own site's For Forms columns
(before, all three read TONK's rows V4:AB30). The 8 TONK Google Forms refresh their dropdowns from
TONK's For Forms columns by heading - copies of their bound scripts are in `asset_forms/` (push with
`clasp push` inside each folder). This also removed the junk choices "SANWARIYA", "EXCAVATOR", ...
that the old V4:AB24 ranges had put into the forms. Asset Receiving Form: no longer errors when
nothing is in transit.
Category spellings from the forms ("TRACTOR", "DUMPER", "VAN & TANKER", "MISCELLANEUOS") now map to
the sheet headings (`normCat_` in assets/Code.js); before, "TRACTOR" filed a received tractor under
MISC. `fixMiscCategories()` (Migrate.js, run once 30 Oct) moved RJ14GD8869 and RJ14GD8873 at NEWAI
from MISC. to TRACTORS.
`fixFormHistory()` (run once 30 Oct) cleaned the form records: "TRACTOR" -> "TRACTORS" (Transfer rows
17, 20; Receiving rows 17, 20) and the 19 Aug short name "RJ26GA4678" -> "RJ26GA4678 (MAHINDRA BLAZO
25 6X4 6C)" (Transfer row 2, Receiving row 3). Audit afterwards: 26/26 vehicles at the site of their
last receipt, nothing in transit, no duplicates.

## Assets: health check + live self-test (30 Oct 2026)
- **Health Check tab** - rewritten after every sync (`healthCheck_` in assets/Code.js; also the
  sheet menu "LIVE SYNC SYSTEM > Health Check"). It replays the whole Transfer / Receiving history and
  lists: vehicle shown somewhere other than its latest form entry, form entry naming a vehicle the sheet
  does not know (spelling), received at a different site than it was sent to, on the way > 3 days,
  listed twice, unknown site or category. "All good" = nothing to fix.
- **liveSelfTest()** (assets/SelfTest.js, run from the editor): a throw-away vehicle goes add ->
  dispatch -> in transit (sheet, both dashboards, updater list) -> wrong site refused -> receive ->
  new site, then every trace is deleted. 30 Oct: all 26 steps passed, nothing left behind.
- Asset Receiving Form: when nothing is in transit its list shows "— Nothing in transit right now —"
  instead of keeping already-received vehicles (which could be "received" again elsewhere).
- **Google Asset Transfer Form and Asset Receiving Form retired (30 Oct 2026).** All transfers and
  receipts now come from the Assets app only. Both forms were unlinked from the sheet (their tabs and
  all 34 + 34 past rows stay; the app keeps appending to them) and moved to the Drive bin; the Receiving
  form's timed dropdown trigger was deleted. Self-test re-run afterwards: all passed.

## Old app links still had 3-10 MB upload caps (31 Oct 2026)
Phones kept old bookmarks / home-screen icons pointing at old deployments, which still ran the
code of the day they were made (3 MB / 8 MB / 10 MB caps, and no GGM Portal sign-in). There were
137 such links: Staff 27, Jaipur 30, Assets 28, Task Delegation 23, Main Admin 20, Newai 7, Tonk 3,
Fuel 2 (Indent and the hub had none). All were moved to the current version, same URLs:
Staff main app 9 (v92), Newai main app 9 (v54), Tonk main app 9 (v26), Main Admin main app 9 (v76),
Jaipur main app 8 (v43), Fuel main app 11 (v52), Task Delegation main app 5 (v63), Assets main app 18
(v80). Spot-checked old links open today's app / portal sign-in. `safe_push.py` now moves EVERY
deployment of an app on every deploy, so an old link can never fall behind again.

## Staff Dashboard users also go on their site's checklist (31 Oct 2026)
When someone is given the Staff Dashboard, the start of their doer name decides where else they go:
`JPR - …` → JAIPUR CHECKLIST Doer List, `NEWAI - …` → NEWAI CHECKLIST, `TONK - …` → TONK CHECKLIST,
anything else → Staff Dashboard only (`staffAddToSiteChecklist_` in Staff_dashboard/PortalApp.js).
The row is Name, Department (from the brackets), Email, Mobile as Username, and a random Password
(the checklists' old login reads column E, so it must never be blank; people sign in via the portal).
Nobody is added twice (same mobile, or same name ignoring "JI"). Each checklist spreadsheet is opened
once per run - they are slow to open. Backfill run the same day (`addSitePeopleToChecklists`, editor):
Jaipur - Saniya, Akhil, Shoji Ram Ji, Hemraj Ji, Raman; Newai - Prashant Pareek, Bhopal Gurjar,
Abdul Khan; Tonk - Rajesh Ji, Lalit Meena. Staff main app 11 (v94).

## Attendance joins GGM Portal (1 Nov 2026, hub "main app 24")
Folder `employee_attendance` (script "Attendance App", sheet **Employee Attendance** `1Msf0vgk…`). v2 login, App ID
**ATTENDANCE** · Fields `role,site` · Sheet ID = the Employee Attendance sheet (row added by Set up / repair tabs).
- **Sign-in:** a portal tile opens it signed in, with the first screen already inside the page. Its own sign-in box takes
  the GGM Portal username / phone + password (portal only since 5 Nov 2026, see below).
- **Who is who:** Role + Site from the Access grid (Supervisor needs a site; HR / Admin blank = all sites). Unticked in
  the portal → out within a minute.
- **Badge:** Supervisor = own workers still to mark (while marking is open); HR / Admin = records waiting for a check.
- **Speed:** Employees / Users / Settings tabs and each site's day column are cached on the server (Fast.js; a write
  through the app updates the copy at once, hand edits show within 45 s–5 min). The phone keeps the last copy of every
  screen and draws it instantly; one call (`bootstrap`) brings it up to date. Chart.js only loads on Trends.
- **Look:** ink & honey (the hub's colours and Inter), dark mode follows the phone or Account → Auto / Light / Dark.
- **New:** supervisors add workers to their own list (next free ID suggested); a search bar on every tab (name or ID);
  every KPI tile opens what it counts; tap anyone for their month calendar (FD / HD / A, HR-approved dots).
- Checks: `portal_connector/checks/attendance.js` (40).

**To finish (owner only):** approve the new permission in the Attendance script (Run anything → Review permissions),
then Apps → ATTENDANCE row → Portal Admin → Connect selected app → paste the key as Script property `PORTAL_KEY`
in the Attendance script. After deploying, Portal Admin → Refresh dropdowns, then tick ATTENDANCE (Role, Site) in Access.

## Renewal Record: typed details follow their document (1 Nov 2026)
Task Feed rows are "the Nth most urgent document", so values typed on a row used to slide onto another document
when the order changed (wrong "Completed" / "Pending", a renewal applied to the wrong row). Now:
- Renewed On / New Valid Until / Cost / Done / Link / Status / Remark / Action By / Action At live in the hidden
  **Feed Inputs** tab, one row per Doc ID; the Task Feed columns are formulas showing them. Typing / ticking in the
  feed still works (the sheet's onEdit moves it to Feed Inputs). Shared logic: `RenewalCore.js` (same file in
  renewal_system, Staff_dashboard, main_admin_dashboard).
- **Complete ticked renewals** checks every date first (new expiry must be later than the current one, Renewed On not
  in the future) and reads each new expiry back after saving; anything that did not stick is listed as NOT completed.
- **Main Admin Approve** finishes the renewal itself (new expiry + Renewal Log line, task leaves the feed); its dialog
  shows the dates staff sent and lets the admin correct them. **Staff Dashboard** submissions are saved as real dates.
- Sheet time zone India (was Pacific); Renewal Log formulas reach row 2000 (were 302).
- Clean-up: 45 misplaced values (19 wrong statuses, 26 empty) were removed from Feed Inputs.
- Live: Staff "main app 12" (v95), Main Admin "main app 10" (v77). Checks: `renewals.js` (17).
- **1 Nov 2026, "main app 2–3":** more colour (tinted tiles, a colour per site); **Record** tab for HR / Admin
  (site + month filters, one row per person: present / half / absent / not marked / man-days, live search,
  hide 0-present, sort, **Print list** = PDF of exactly what is shown); **employee photos** (hidden tab
  *Employee Photos*: camera or gallery from Add employee / Add a worker or by tapping any avatar; the phone
  shrinks any picture to ~30 KB, a 120 px thumb for lists); a new year's site tab keeps last year's
  hand-arranged row order (blank separator rows and column-B labels too); person sheet shows only the actions
  that fit (no Approve once approved) and every list, Record included, updates the moment a status changes.
  Checks: `attendance.js` (58).
- **1 Nov 2026, "main app 4–5":** phone layout for Attendance and the hub (hub "main app 25"); **punch report check**:
  HR / Admin upload the punching machine's *Daily Punch Report* (.xlsx) from Verify or More → the phone reads it
  (only first / last punch + count per person per day are sent) → every marked day cell on the site tabs whose mark
  does not fit the punches gets a bright red font (a fitting one goes back to black, so re-uploading clears old red).
  Rules: no punch = Absent; one punch = present; first→last ≥ Full-day hours = Full; ≥ Half-day hours = Half; less =
  Half or Absent. Hours per site in More → Site rules (Settings F / G, default 7 h / 4 h). Blank cells and days after
  today are never touched. Matched by Employee ID. `Punch.js`; checks in `attendance.js` (63).

## Newai Checklist: Done was not saved after 31 Oct 2026 (3 Nov 2026, "main app 10" / "11")

**What broke:** the app saved checklist (routine) ticks into a tab called **MM**. That tab was removed from the Newai sheet on the morning of 31 Oct; the last tick that reached the sheet was 31 Oct 08:34:57. From then on the server found no MM tab, wrote nothing, and still answered "success", so people saw "updated!" and the task came back. Photos were uploaded to Drive but their links were never written. Loads also became slow (6–13 s, once 122 s), because with MM gone the app read the whole Master tab (25,553 rows) on each load. Delegated tasks were not affected.

**Now** (`newai_checklist/Routine.js`):
- A Done or note goes straight into **Master**, on the row with that Task ID (column D; all 25,553 IDs are unique). Actual goes to H, "Done" to I, and notes/file links are added to L. The same change is copied to that Task ID in **Monthly Master** (the 2 AM trigger still rebuilds it from Master).
- The row must belong to the signed-in person (name, or a Doer List name with the same mobile).
- Anything that is not saved is reported with the reason ("no longer in the sheet", "too early", "finish the one due … first"). Those tasks go back to pending in the app; nothing is reported as "updated".
- **Speed:** one read of Master builds a per-person copy in the script cache (live size about 380 KB for 13 people). Each save patches that copy. A hand edit in Master or Monthly Master (onEdit), new tasks (createChecklist), and the 2 AM rebuild all drop the copy, as does a new day. The copy holds this month, anything in Review, and open W/M/Q/Y tasks that are overdue or due within 40 days.
- **Early ticks:** a W/M/Q/Y task can be marked from 6 days before its date (`RT_EARLY_DAYS`), and only the oldest open occurrence of the same task. Otherwise the card shows a lock ("Can be marked from dd/mm" / "Finish the one due … first"), and the server refuses it too. Notes can still be saved. Daily tasks are unchanged.
- `syncMMtoMaster` / `monthlyRolloverMM` are left in the code unused (no triggers).
- Check: `portal_connector/checks/newai_save.js` (26).
- Live check: run `newaiSelfTest` in the editor (read-only). On 3 Nov 2026 ("main app 11", v56): the first load built the copy in 5.1 s, each person then loaded in 50–106 ms, and 13 of 13 Task ID lookups found the right row. GOVIND SINGH, PRASHANT PAREEK, BHOPAL GURJAR and ABDUL KHAN are in the Doer List but have no rows in Master.
- **Lost ticks:** taps between 31 Oct 08:35 and this deploy are not stored anywhere. Today's daily tasks and any open W/M/Q/Y tasks can be ticked again in the app. Past days' daily tasks are not shown in the app (only today's), so those can only be fixed in the sheet.

## Newai people work their checklist in the Staff Dashboard (4 Nov 2026, Staff "main app 13"–"15")
**Why people could not get in:** since 31 Oct nobody has **NEWAI CHECKLIST** ticked in Access (the Newai people
were moved to STAFF DASHBOARD, the "Checklist App" tile). People still opening the old Newai link were refused
("DENIED … direct login, not assigned" in Log). And the Staff Dashboard showed Newai tasks to peons only, read
from Newai **Monthly Master** and saved only there, which the 2 AM job rebuilds from Master (ticks lost).

**Accounts (hub):** 7 Newai Doer List people had no portal account. They were added on Users rows 75–81, Active,
STAFF DASHBOARD ticked with a doer name `NEWAI - NAME (DEPT) - MOBILE`: AKBAR ALI, DINESH, KHUSHIRAM GURJAR,
`PRASHANT SORTER` (Prashant 8104111191; `PRASHANT` is Prashant Pareek), SUNIL KUMAR, GOVIND SINGH, CHANDAN SHRIVASTAV.
Sync: all 17 Newai people OK for STAFF DASHBOARD. **Their passwords are set by the admin** (Users → Set Password);
they have no email, so "First time here?" cannot send them a code.

**Staff Dashboard** (`Staff_dashboard/NewaiRoutine.js`, the same rules as `newai_checklist/Routine.js`):
- Doer name starting `NEWAI -` (and peons): tasks come from the Newai **Master**, matched by the Newai Doer List
  name on the same mobile as the doer name ("SUNIL JAT" → "SUNIL CHOUDHARY"). They no longer get Jaipur rows that
  only share a first name. Shown: this month, Review, open W/M/Q/Y overdue or due within 40 days.
- Done / notes go to that Task ID's Master row (H Actual, I "Done", notes + file links added to L) and to the same
  Task ID in Monthly Master. W/M/Q/Y: from 6 days before the date, oldest open one first (the card shows a lock).
- Anything not saved is reported with the reason, and the page puts that task back (it used to say "done" and
  keep it hidden, also for a missing Jaipur task).
- Speed: one read of the Newai Master (6.5 s live) is cached for everyone for 30 minutes or until the next day, and
  patched on every save here. So edits made in the sheet itself, or in the Newai app, show within 30 minutes.
- Live self-test (`staffNewaiSelfTest`, editor, read-only, writes to the execution log only) on 4 Nov 2026:
  13 NEWAI people loaded in 46–108 ms each, 13/13 Task ID lookups found the right row. Bhopal Gurjar, Abdul Khan,
  Govind Singh (and Prashant Pareek) have no rows in the Newai Master, so their checklist is empty.
- Check: `portal_connector/checks/staff_newai.js` (31).
- "main app 14" (v97) is the same code as 13; "main app 15" (v98) only makes the self-test log-only.
  The editor copy logs with console.log (pushed to HEAD only).

## Attendance: Portal Users is the only user list (5 Nov 2026, Attendance "main app 6", v13)
The old **Users** tab of the Employee Attendance sheet is deleted (it can be brought back from File → Version history).
Its shared logins (Admin, HR, Jaipur, Tonk, Sanwariya, Khakhunda, Newai, Newai01–03) no longer work, and any session
opened with one has ended.
- **People:** `Portal Users ATTENDANCE` only. Add someone in the hub's Access tab: tick ATTENDANCE, pick Role, pick Site
  (a Supervisor needs a Site). The app's user forms, its passwords and the "link to GGM Portal" field are gone.
  More → App users is now a read-only list.
- **Employees → Supervisor dropdown:** the portal usernames with the Supervisor role. `warmCaches` compares the list every
  5 minutes (`syncSupervisorDropdown_`) and rewrites the dropdown only when it changed. Seen live: it moved from the old
  9 names to JAGDISH by itself. An empty list is ignored (it means the tab could not be read).
- A Supervisor cell holding a name that is not a portal supervisor counts as unassigned: everyone at that site's
  supervisor list sees that worker, so nobody disappears.
- **State on 5 Nov:** the only portal Supervisor is JAGDISH (Newai). 802 Supervisor cells are blank and 3 Newai rows
  still hold Newai / Newai01 / Newai02 (they were all filled at 14:24 that day; the app writes that column one row at
  a time only, so a bulk blank did not come from it). Jaipur, Tonk, Khakhunda and Sanwariya have no supervisor yet; HR
  and Admin can still see them.
- `safe_push.py --retire name,name`: named, on-purpose removal of functions (all other functions are still protected).
- Check: `portal_connector/checks/attendance.js` (73).

## Assets: receiving date, or Pending (12 Nov 2026, Assets "main app 19", v81)
Only the transfer date was visible; the receipt half of each History row was never shown.
- Dashboard (recent movements): under each sent date, "Received: <date>" or an amber **Pending · N days**.
- History Logs: one row per movement - Sent On · Asset · From · To · **Received On** (date or Pending). Filter:
  All / Received / Not Received Yet (Pending).
- Asset details: **Last Sent** (date and route) and **Received On**.
- History tab: each transfer is paired with the first receipt of that asset at or after it (was: 1st transfer with
  1st receipt by count, which slides every later receipt once one receipt has no transfer). The live rows paired
  the same either way on 12 Nov.
- Check: `portal_connector/checks/assets_received.js` (13).

## Attendance: second site (13 Nov 2026)
- **No supervisor** (Employees D blank): every supervisor at the person's site has them ("Shared with the other
  supervisors"). This was already so (`SUPERVISOR_SEES_UNASSIGNED`); since 5 Nov every D cell is blank.
- **Second site** (Employees column **G "Secondary Site"**, dropdown of the 5 sites; also in the app: Employees → add /
  edit → *Second site*): every supervisor at that site also gets the person on their marking list, tagged
  "Staying here from <main site>". The mark is written on the **main site's** year tab (one record per person per
  day, so month totals and HR approval stay with the main site). The main site's supervisors keep them too; whoever
  marks first wins, the other sees it marked. The supervisor badge counts them. The marking window is the marking
  supervisor's own site's. Blank, unknown or same-as-main values in G are ignored; case does not matter.
- HR's Today / Record screens list the person under their main site only.
- Check: `portal_connector/checks/attendance.js` (86).

## Attendance: punch mismatches are purple cells (13 Nov 2026, Attendance "main app 8", v15)
- Punch report (More → Punch report): a mark that does not fit the punches gets a **purple background**
  (`CLR_MISMATCH` #b4a7d6, state `Mismatch`) instead of red text. Purple means "waiting for HR" again, whatever the cell's
  approval colour was before. Text is set back to black (clears red text left by earlier uploads of the same dates).
- HR: purple counts as "Awaiting check" (and in the HR badge), shows "Punches don't match"; **Approve all skips it**
  (the app says how many are left). Approve → green, Send back → yellow, as before.
- After a correction (in the app or in the sheet), uploading the report again turns a purple cell that now fits back
  to light red (waiting for HR). Grey (switched-off) and blank cells are never touched.
- Check: `portal_connector/checks/attendance.js` (90).
- **Update (13 Nov 2026, "main app 9", v16):** the upload counts as HR's check. Every marked day that fits the punches
  turns **green (approved)** and every one that does not turns **purple**, whatever colour it had before (also a
  yellow "sent back"). Blank, grey and future days are untouched. After a correction, upload again: it turns green.
  Result screen: Fit — approved / Different (purple) / Punched, not marked / Not on attendance. Check (91).
- **Update (13 Nov 2026, "main app 10", v17):** the upload also takes the machine's **Muster Report** (day cells FD / HD /
  A / P = the machine's verdict, compared with the mark as is; WO / "-" skipped; today's column skipped because it is
  still changing). Daily Punch Report: a last punch earlier in the day than the first counts as the next morning (night
  shift 09:00 PM-02:00 AM = 5h, not 19h). Checked on the real files: daily_punch_report (Sep 2026, 779 people, 8,239
  punched days; 344 overnight cells, all Full Day either way) and muster_report (1-13 Nov, 816 people). Check (98).

## Attendance: punch notes, result lists, auto Absent (13 Nov 2026, "main app 11", v18)
- **Notes:** a purple cell gets a note: `Punch report (<file>, <date time>, <user>)` / `Punches: 9:20 AM–1:10 PM (3h50)` /
  `Marked: Full Day` / `Punches fit: Half Day`. The note is removed when the mark fits on a later upload. Notes not
  written by the app are never touched.
- **Result tiles open their lists:** Fit (approved), Different (purple, with what fits), Punched-not-marked (with the
  punch times), Not on attendance (name + department from the file). People in the report whose Employee ID is not on
  the attendance are only listed: nothing is written for them. Add them in Employees with the same ID, upload again.
- **Auto Absent:** `autoAbsent_` runs from `warmCaches` (every 5 min). After a site's closing time, every active person
  still not marked today is set to **A**, light red (waiting for HR), note `Auto-marked Absent: not marked by 15:00 on
  …`. Once a day per site. A site where nobody was marked that day is skipped (holiday / no supervisor) and logged
  AUTO_ABSENT_SKIPPED. Switch per site: Site rules → "At closing time" (Settings column H, blank = on). HR changing an
  auto Absent removes its note. A later punch upload turns an auto Absent of someone who punched purple.
- Check: `portal_connector/checks/attendance.js` (108).
- Note: Git Bash here ignores `TZ=Asia/Kolkata` (prints UTC). Use the browser or Python for India time.
- **Update ("main app 12", v19):** a blank (not marked) day on which the report shows punches also turns purple, note
  "Marked: nothing" with the punch times and what would fit. Blank days without punches (or A / WO / "-") stay blank.

- **One-off ("main app 13", v20, 13 Nov 2026):** `backfillAbsentOnce_()` (run once by `warmCaches`, guarded by script
  property `ATT_BACKFILL_2026-10-01`) filled every empty day from 1 Oct 2026 to yesterday with A, light red (waiting
  for HR), note "Auto-marked Absent: day left empty, filled in on …". Empty purple (punched) days got A, stayed purple,
  note "Marked: Absent". Skipped: switched-off people, grey cells, and days where nobody at the site was marked.
  Result rows: AuditLog action `BACKFILL_ABSENT`. To undo, clear the cells whose note starts "Auto-marked Absent: day left empty".
  Ran 13/11 17:40: Newai 20,743 filled (7-12 Nov left empty: nobody marked), Jaipur 28, other sites nothing marked.
- **Update ("main app 14", v21):** hand edits in the sheet show in the app at once. An installable onChange trigger
  `sheetChanged` (self-installed by `warmCaches` via `ensureChangeTrigger_`, flag `ATT_CHANGE_TRIGGER`; also in
  `installTriggers`) drops the saved copies (today's day rows, all this year's month records, Employees, Settings,
  overview) and re-syncs the supervisor dropdown. Pages then pick it up on their next refresh (Site rules seconds).
- **Update ("main app 15", v22): no holidays.** Auto Absent at closing (`autoAbsent_`, key now `ATT_AUTOABS2_<site>`)
  also marks a day when nobody at the site was marked. The one-off fill ran a second pass (`ATT_BACKFILL2_2026-10-01`)
  that filled the days the first pass skipped, at every site whose Site rule "At closing time" is on. The only way to
  stop it for a site is Site rules → "Leave them unmarked".
- **"main app 16" (v23):** the "Add a worker" button is a round + on the right of the dark Mark-today tile.
- **"main app 17" (v24):** Mark-today filter "My workers · N" = people whose Employees Supervisor is this supervisor
  (not the site's shared/unassigned people, not visitors from another site).
- **"main app 18": "Marked by me" filter.** `submitAttendance` adds the id to script property
  `ATT_BY_<today>_<username>` (`addMarkedByMe_`); `supervisorData_` flags `byMe`. If the property is missing it is
  rebuilt from today's AuditLog MARK / RESUBMIT rows (`markedByFromAudit_`). `nightlyMaintenance` deletes older days' keys.

### Assets app, 14 Nov 2026 ("main app 20" v82, "main app 21" v83)
- Cancel transfer needs a reason; recorded in new tab **Cancelled Transfers** (Cancelled At, By, Asset, Category, From, To,
  Driver, Sent At, Sent By, Photos, Remarks, Reason). Only an asset that is in transit can be cancelled.
- Driver name / vehicle no. is required on a transfer (page + `processWebTransfer`).
- **History** tab now B..S: K-S = Sent By, Driver, Photos, Remarks (sent) | Received By, Driver, Photos, Remarks (received) |
  Cancelled ("when | who | reason"). Cancelled transfers stay in the log. The grid grows rows/columns itself.
- Photos: `getAssetPhotos(token, ids, full)` returns thumbnails / full photo as data URLs, only for Drive ids found in the
  History photo columns. Nobody needs Drive access to see them.
- Phones: Movement log + Overview ledger are compact cards (asset, status, route, sent/received time, driver, remarks,
  photo thumbnails, Receive/Cancel buttons). Fleet + History filter bars = search + "Filters" button (dropdowns fold away).
- Checks: `assets_received.js` (26), `assets.js` (54).

## Hub: "Copy link" on forms (14 Nov 2026, hub "main app 26", v31)
- In the Forms list each tile has a **Copy link** button where the ↗ arrow was. Tapping the tile still opens the form.
- The link is still handed out only on the tap (`openLink(session, 'form', name, 'copy')`): the tick is checked again, and the Log records `COPY LINK` instead of `OPEN`.
- If the phone's browser refuses to copy, a small box shows the link to copy by hand.
- Sheets keep the arrow.
- `albert.js` (a one-line comment someone added in the online editor) is kept and allowed in `.claspignore`.

## Leads & Orders joins GGM Portal (14 Nov 2026, app "main app 1", hub "main app 27")
Folder `leads_orders` (script `1B7hEqx7…`, bound to the new sheet **Leads & Orders App** `1sQ_3GJ5NuMqqMSKFJrezxFG2cyk35tmLq6_WXzj4FpI`).
Live link: `https://script.google.com/macros/s/AKfycby_i8FyBg7koPXFPoE-9y81Heyv-zHH6LZJLBJZOacIXCsUCTl4Qz6gCcwuOARs3Rde1A/exec` (deployment "main app 1").
App ID **LEADS** · Fields `role,doer` · Roles Admin / Manager / Executive · Doer name = the name in the FMS sheets (ATT. NAME / SALES PER.).
- **Data:** the two FMS sheets stay the source of truth (01.LEADS TO ORDER FMS `1PzN…`, 2. ORDER TO DELIVERY `1xe2…`). Steps,
  hours (row 5), answers (Config tab) and fields are read from the sheet headings; the app writes Actual / answer / fields into the
  same cells. Planned = the sheets' own formula; the app only works a deadline out itself after a send-back (clock restarts).
- **Own tabs** in Leads & Orders App: Events (who did what), Notes, Photos (Drive folder "Leads & Orders — photos"), Lead State
  (restarts, hand closings, industry, lead↔order links), Activity (opens + screen time), Settings, Portal Users LEADS.
- **Board:** one column per step, one tile per lead; green on time · yellow under 30 % of the time left · red overdue (red always on
  top). Answers decide where the tile goes (Settings → Answer rules): next · stay (follow-up) · back to a step · won · lost. Field rules:
  sample "Failed" / "Req. Another Sample" / "Un Delivered" → back to Send sample; client "No" → back to Station.
- **Who answers:** the lead's owner where "Lead owner" is ticked (all Leads steps, Order steps whose Who says SALES); Station / Site /
  Accounts steps need people ticked in Settings → Steps & people. Admin / Manager can answer anything.
- **Performance:** score from Events + steps entered in the sheet (credited to the owner) + opens / screen time; trends; team table.
  An evening trigger (19:00) charges overdue tiles to their people.
- Checks: `portal_connector/checks/leads.js` (64).

**To finish (owner only):**
1. Open the Leads & Orders App sheet → Extensions → Apps Script → run `setup` → approve the permissions.
   (Or reload the sheet and use the **Leads & Orders** menu → Set up / repair.)
2. GGM Portal sheet → Portal Admin → **Set up / repair tabs** (adds the LEADS row with its link and sheet) → click the LEADS row →
   **Connect selected app** → copy the key → in the Leads & Orders App sheet: **Leads & Orders → Paste GGM Portal key…**.
3. Portal Admin → **Refresh dropdowns**, then tick LEADS in Access with Role + Doer name (e.g. Executive · SURAJ).
4. In the app (Admin): Settings → Steps & people → tick who answers Station, Transport, Dispatch, Payment confirmation, Invoice,
   Delivery (the Order → Delivery steps not done by the sales person).

**Done 14 Nov 2026 (17:30–17:45):** app permissions approved and `setup` run (tabs, photo folder, 4 triggers; both FMS layouts
read fine) · hub Set up / repair added the LEADS row + Access columns · ticked in Access and synced: admin (Admin), SURAJ,
HEMANT AGARWAL, BHOPAL GURJAR (Executive) · Arrange transport assigned to Hemant + Bhopal (Settings tab).
**Still open:** PORTAL_KEY (owner pastes: Leads & Orders → Paste GGM Portal key…), then Portal Admin → Refresh dropdowns;
Nakul / Vipin / Neeraj (Manager, doer NAKUL GOYAL / VIPIN GOYAL / NEERAJ KUMAR GOYAL) and AAYUSHI KHANDELWAL
(Executive, doer AAYUSHI) still to be ticked by the owner.

## Leads & Orders: no doer names (14 Nov 2026, app "main app 2", hub "main app 28")
- Hub Fields for LEADS = `role` only (Apps row + DEFAULT_APPS); Access grid refreshed (Doer column gone), synced.
- Whoever signs in is who they are. Leads are theirs when ATT. NAME / SALES PER. matches their portal name or username
  (SURAJ → SURAJ / SURAJ KUMAR, Vipin Goyal → VIPIN GOYAL, username NEERAJ → NEERAJ KUMAR GOYAL, AAYUSHI KHANDELWAL → AAYUSHI).
- Admin assigns inside the app: Settings → **People** (other spellings; the first one is written for new / assigned leads,
  plus a list of open-lead names nobody matches), Settings → Steps & people (who answers each step), and **Assigned to** on
  every lead (Admin / Manager) and in the New lead form. An Executive's new lead is always their own.
- Checks: leads.js 71.

## Leads & Orders: usernames, speed, compact board (14 Nov 2026, app "main app 4")
- **Owner names = Master App usernames, permanently.** One-time run renamed 261 cells: AAYUSHI → AAYUSHI KHANDELWAL (91),
  NAKUL GOYAL → NAKUL (62), Suraj → SURAJ (41), SURAJ KUMAR → SURAJ (33), VIPIN GOYAL → VIPIN (25), NEERAJ KUMAR GOYAL →
  NEERAJ (9). Not matched (left as is): MAAHI, SHOJI RAM JI — add the spelling to a person in Settings → People.
  The 10-minute job renames new rows too (Google Form entries). Users are read from Master App → Users (HUB_SHEET_ID).
  Lead Ratio (01.LEADS TO ORDER FMS) person dropdown D2 now: ALL / SURAJ / AAYUSHI KHANDELWAL / MAAHI.
- **Speed.** The order sheet's formulas run 50,000 rows down, so a full read of both sheets takes ~60 s. It now only
  happens in triggers (any hand edit → rebuild in the background; every 30 min). Visitors get the saved board (~0.25 s on the
  server); saves patch the saved board. The page draws the last copy kept on the phone at once; opened from the portal tile,
  the data is inside the page. Saving updates the screen at once (server confirms in the background; undone with a message
  if it refuses). The side panel opens at once from the board; history fills in. Timings: `…/exec?bench=1` (numbers only).
- **Board.** Compact columns (toggle), empty steps fold to a slim strip, step strip on top to jump, ‹ › buttons and side
  arrows, ← → keys, drag the empty board area with the mouse; no redraw while scrolling. Ribbon: **Late by** (0–1, 1–3, 3–5,
  0–5, 5–10, 10–20, 20–30, 30+ days, custom range), More filters panel.
- **Dashboards.** Charts fit the screen; team KPIs; "Pipeline now" (open / overdue per step, tap to jump); last view shown at once.
- Checks: leads.js 81.

### Leads & Orders — own backend (main app 7)
Everything now lives in the **Leads & Orders App** sheet: `LEADS` and `ORDERS` (same layout as the old FMS sheets, plain values, colour-coded step blocks), `Steps` (step key, when the clock starts, answer options — edit answers here), `Holidays` (office hours, weekly off, holidays), plus Events / Notes / Photos / Lead State / Activity / Settings / Portal tabs.
The two old FMS sheets and their Google Forms are no longer used: every new lead and order is entered in the app (+ New lead / + New order). The form import was removed in main app 11.
Dropped from ORDERS: the 7 per-mine "Material Grade (…)" columns (merged into Mat. Gr.), Delay Days, Est. Date (one day bef).
