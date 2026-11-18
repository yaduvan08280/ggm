/*******************************************************
 * Config.gs — edit SITES to match your real site names.
 * Everything else can normally be left alone.
 *******************************************************/

// Your sites. Tab names are built as "<Site>_<yyyy>", e.g. Tonk_2026.
// After adding one here, run syncSites() once from the editor.
const SITES = ['Tonk', 'Newai', 'Khakhunda', 'Sanwariya', 'Jaipur'];

const APP_TITLE = 'Attendance';
const TZ = 'Asia/Kolkata';

// Master tabs
const SHEET_EMPLOYEES = 'Employees';
const SHEET_SETTINGS  = 'Settings';
const SHEET_AUDIT     = 'AuditLog';

/* ---------------- Employees tab columns ----------------
 * A: Employee ID | B: Name | C: Site | D: Supervisor | E: Designation | F: Active | G: Secondary Site
 * The Supervisor cell holds the supervisor's GGM Portal USERNAME: the dropdown is the
 * Supervisor rows of "Portal Users ATTENDANCE" and follows that tab by itself.
 * ------------------------------------------------------ */
const EMP_COL_ID         = 1;
const EMP_COL_NAME       = 2;
const EMP_COL_SITE       = 3;
const EMP_COL_SUPERVISOR = 4;
const EMP_COL_DESIG      = 5;
const EMP_COL_ACTIVE     = 6;
// G: a second site the person also works at (stays there for a week at a time). Every supervisor
// there can mark them; the mark is kept on their main site's sheet, so it is counted once.
const EMP_COL_SECONDARY  = 7;
const EMP_COL_COUNT      = 7;

// Blank Supervisor cell: true = every supervisor at that site sees the employee,
// false = nobody sees them until one is named.
const SUPERVISOR_SEES_UNASSIGNED = true;

/* ---------------- attendance tab layout ----------------
 * One tab per site per YEAR. One column per day.
 *
 *   Row 1 |  A: Employee ID | B: Name |<------ January ------>|<-- February ...
 *   Row 2 |                           | 1 Th | 2 Fr | 3 Sa ... | 1 Su | ...
 *   Row 3 |  TNK-001        | Ramesh  |  FD  |  A   |  HD      |  FD  | ...
 *
 * The cell value is the attendance code. HR approval is the cell COLOUR,
 * never a separate column.
 * ------------------------------------------------------- */
const FIRST_DATA_ROW = 3;   // row 1 = month band, row 2 = day, row 3+ = employees
const FIRST_DAY_COL  = 3;   // col A = Employee ID, col B = Name
const COLS_PER_DAY   = 1;

// Cell codes — what actually sits in the day column
const CODE_FULL   = 'FD';
const CODE_HALF   = 'HD';
const CODE_ABSENT = 'A';
const DAY_CODES   = [CODE_FULL, CODE_HALF, CODE_ABSENT];

const CODE_TO_STATUS = { FD: 'Full Day', HD: 'Half Day', A: 'Absent' };
const STATUS_TO_CODE = { 'Full Day': CODE_FULL, 'Half Day': CODE_HALF, 'Absent': CODE_ABSENT };

/* ---------------- approval colours ----------------
 * The background of a day cell IS the HR approval state.
 *   red    — the day has happened and HR has not approved it yet
 *   green  — HR approved
 *   yellow — HR sent it back for correction (supervisor may re-mark)
 *   purple — the punch report does not fit the mark (Punch.gs); HR checks it one by one
 *   grey   — employee is switched off; nothing to mark
 *   white  — day has not happened yet
 * Sheets returns backgrounds lower-case, so keep these lower-case.
 * -------------------------------------------------- */
const CLR_PENDING  = '#f4c7c3';
const CLR_APPROVED = '#b7e1cd';
const CLR_SENTBACK = '#ffe599';
const CLR_MISMATCH = '#b4a7d6';
const CLR_INACTIVE = '#d9d9d9';
const CLR_FUTURE   = '#ffffff';

// Approval states used across the app
const APPROVAL_PENDING  = 'Pending';
const APPROVAL_APPROVED = 'Approved';
const APPROVAL_SENTBACK = 'SentBack';
const APPROVAL_MISMATCH = 'Mismatch';   // purple: waiting for HR, never in "Approve all"

// Header colours
const CLR_HEADER_DARK  = '#1B1035';
const CLR_MONTH_A      = '#EDE7FF';
const CLR_MONTH_B      = '#E3F0FF';
const CLR_DAY_HEADER   = '#F3F0FF';
const CLR_SUNDAY_HEAD  = '#FFE3EC';

// Defaults used when a site has no row in the Settings tab
const DEFAULT_CLOSING_TIME   = '15:00';
const DEFAULT_REFRESH_SEC    = 30;
const DEFAULT_LOCK_LOGIN     = true;  // supervisors cannot log in after closing time
const DEFAULT_ALLOW_RESUBMIT = true;  // if HR sends a record back, supervisor may redo it
// Punch report check (Punch.gs): first-to-last punch at least this long = Full / Half day (Settings F / G)
const DEFAULT_FD_HOURS = 7;
const DEFAULT_HD_HOURS = 4;

// Sessions
const SESSION_CACHE_PREFIX = 'ATT_SESS_';
const SESSION_TTL_SECONDS  = 12 * 60 * 60;   // 12h — covers a full shift plus overtime

// How long a year sheet may go without re-checking the roster
const EMP_SYNC_TTL_SECONDS = 300;

// Day-column width in the sheet
const DAY_COL_WIDTH = 44;

// Speed (Fast.gs): seconds the server keeps a copy of each tab. Writes made in the
// app refresh the copy at once; warmCaches() (every 5 minutes, Triggers.gs) re-reads
// the day columns and the Admin numbers, so hand edits in the sheet show within 5 minutes.
const CACHE_DAY_SEC      = 600;   // today's column of each site
const CACHE_EMP_SEC      = 120;   // Employees tab
const CACHE_SETTINGS_SEC = 300;   // Settings tab
const CACHE_OVERVIEW_SEC = 900;   // Admin month-to-date numbers (took 16-30 s to work out)
