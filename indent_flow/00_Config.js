/**********************************************************************
 * PLANT INDENT & PROCUREMENT SYSTEM  (GG Minerals)
 * File: 00_Config.gs   —  Constants, schema and stage definitions
 * ------------------------------------------------------------------
 * NOTE: Nothing in this file executes at load time except constant
 * declarations, so it is safe for Apps Script's global scope.
 *********************************************************************/

/** Application meta ------------------------------------------------ */
var APP = {
  NAME       : 'Plant Indent & Procurement System',
  SHORT      : 'Indent Flow',
  VERSION    : '8.3.1',
  TIMEZONE   : 'Asia/Kolkata',
  DRIVE_FOLDER: 'Indent System Photos',
  SESSION_HOURS: 12
};

/** Sheet (tab) names ------------------------------------------------ */
var SH = {
  USERS      : 'Users',
  INDENTS    : 'Indents',
  STAGES     : 'Stage_Timings',
  HISTORY    : 'History',
  VENDORS    : 'Vendors',
  QUOTES     : 'Quotations',
  STOCK      : 'Stock_Logs',
  FOLLOWUPS  : 'Followups',
  REMINDERS  : 'Reminders',
  ATTACH     : 'Attachments',
  NOTIFY     : 'Notifications',
  SESSIONS   : 'Sessions',
  SETTINGS   : 'Settings',
  SITES      : 'Sites',
  SECTIONS   : 'Sections',
  ITEM_REQ   : 'Item_Requests',
  TRANSFERS  : 'Transfers'
};

/** The four sites. Stock, item lists and the store team are per-site. */
var SITES = ['TONK', 'NEWAI', 'SANWARIYA', 'KHAKHUNDA'];

/** Each site keeps its own inventory tab. */
function invSheet_(site) {
  var s = String(site || '').toUpperCase().trim();
  return SITES.indexOf(s) === -1 ? '' : ('INV_' + s);
}
function isSite_(s) { return SITES.indexOf(String(s || '').toUpperCase().trim()) !== -1; }

/** Roles that must belong to exactly one site, and roles that work across all. */
var SITE_BOUND_ROLES = ['USER', 'STORE'];
function roleNeedsSite_(role) { return SITE_BOUND_ROLES.indexOf(String(role || '').toUpperCase()) !== -1; }

/** Columns of every INV_<SITE> tab. */
/* Columns of every INV_<SITE> tab.
 *
 *  NOTE on order: new columns go at the END, never in the middle. A
 *  sheet's data rows are positional, so inserting a column mid-list
 *  would shift every historic value one place to the right.
 *
 *  Three of these are DERIVED and written back by the app — editing
 *  them by hand achieves nothing, the next sweep overwrites them:
 *      Avg_Daily_Consumption   out-movements over the lookback window
 *      Reorder_Point           (ADC x Lead_Time) + Safety_Stock
 *      Total_IN / Total_OUT / Current_Stock   summed from the ledger
 *
 *  Initial_Stock is the opening balance and IS yours to set: it is the
 *  anchor every later figure is derived from.
 */
var INVENTORY_COLUMNS = ['Item_Code', 'Item_Name', 'Part_Number', 'Unit', 'Section',
  'Current_Stock', 'ROP_Override', 'Max_Order_Qty', 'Notes', 'Active',
  'Created_By', 'Created_At', 'Updated_By', 'Updated_At',
  'Avg_Daily_Consumption', 'Lead_Time_Days', 'Safety_Stock', 'Reorder_Point',
  'Min_Order_Qty', 'Initial_Stock', 'Total_IN', 'Total_OUT'];

/** How many days of out-movements the consumption average looks back over. */
var CONSUMPTION_LOOKBACK_DAYS = 30;

/** Reorder point = what will be used up while the order is in transit,
 *  plus the buffer you always want on the shelf.
 *      ROP = (average daily consumption x lead time) + safety stock */
function reorderPointOf_(adc, leadDays, safety) {
  var n = (num_(adc, 0) * num_(leadDays, 0)) + num_(safety, 0);
  return Math.round(n * 100) / 100;
}

/** Column schema.  Order here == order in the sheet. ---------------- */
var SCHEMA = {
  Users: ['User_ID','Name','Role','Site','Phone','Email','PIN_Hash','Active','Created_At',
          'Telegram_Chat_ID','Telegram_Username','Telegram_Linked_At','Telegram_Link_Code',
          'Telegram_Code_Expires','Notify_Telegram','Language'],

  /* NOTE: new columns go at the END of a list, never in the middle. An
     existing sheet's data rows are positional, so inserting a column
     mid-list would shift every value in every historic row one place
     to the right. `Section` and `Balance_After` are here for that reason. */
  Indents: ['Indent_ID','Timestamp','Requester_ID','Requested_By','Site','Part_Number',
            'Part_Name','Quantity','Unit','Description','Photo_URL','Priority',
            'Current_Stage','Status','Stage_Entered_At','Stage_Planned_At',
            'Store_Action','Issued_Qty','Store_Remarks',
            'Purchase_Mode','Purchaser','Final_Vendor','Final_Amount','Approved_By','Approved_At',
            'Approval_Route','Shop_Name','Shop_Bill_No','Shop_Purchase_At',
            'ETA','Destination_Type','Primary_Location','Secondary_Location','Transit_ETA',
            'Dispatch_Status','Vehicle_Details','Bill_Photo_URL','Material_Photo_URL',
            'First_Receipt_Location','First_Received_Qty','First_QC_Result','First_QC_Remarks',
            'First_Received_At','First_Receipt_Photo_URL',
            'Received_Qty','QC_Result','QC_Remarks','Final_Receipt_Location','Plant_Receipt_Photo_URL',
            'Confirmed_By','Confirm_Remarks','Remarks',
            'Created_At','Updated_At','Completed_At','Total_Cycle_Mins','Total_Delay_Mins','Last_Alert_At',
            'Section','Requested_Qty','Requester_Received_Qty',
            'Parent_Indent_ID','Split_Reason','Raised_By_Role','Issued_To_Name'],

  Stage_Timings: ['Row_ID','Indent_ID','Stage_No','Stage_Key','Stage_Name','Owner_Role',
                  'Entered_At','Planned_At','Completed_At','Completed_By','Completed_By_Name',
                  'Duration_Mins','Delay_Mins','Status','Note'],

  History: ['Log_ID','Timestamp','Indent_ID','Stage_Key','Stage_Name','Action','Category',
            'Actor_ID','Actor_Name','Actor_Role','From_Status','To_Status','Details','Notes'],

  Vendors: ['Vendor_ID','Vendor_Name','Contact_Person','Phone','Email','Category','Active',
            'Created_By','Created_At'],

  Quotations: ['Quotation_ID','Indent_ID','Vendor_ID','Vendor_Name','Brand','Price_Per_Unit',
               'Quantity','Total_Amount','Delivery_Days','Remarks','Status','Created_By',
               'Created_At','Decided_By','Decided_At'],

  Stock_Logs: ['Transaction_ID','Indent_ID','Product_Name','Part_Number','Quantity',
               'Transaction_Type','Site','Actor_ID','Actor_Name','Timestamp','Remarks',
               'Balance_After','Moves_Stock','Issued_To'],

  Followups: ['Followup_ID','Indent_ID','Stage_Key','Stage_Name','PC_ID','PC_Name',
              'Contact_Mode','Called_Whom','Called_Whom_Phone','Notes','Outcome',
              'Reminder_Set','Reminder_At','Reminder_Note','Reminder_ID','Created_At'],

  Reminders: ['Reminder_ID','Followup_ID','Indent_ID','Stage_Key','Stage_Name','PC_ID','PC_Name',
              'PC_Email','Remind_At','Note','Status','Calendar_Event_Id','Created_At','Sent_At'],

  Notifications: ['Notification_ID','Timestamp','Event','Indent_ID','Channel','Recipient_ID',
                  'Recipient_Name','Target','Status','Error','Message'],

  Attachments: ['Attachment_ID','Indent_ID','Stage_Key','Stage_Name','Kind','Label','File_Name',
                'URL','Uploaded_By_ID','Uploaded_By','Uploaded_At'],

  /* Goods moving between two of the four sites, outside the indent
     pipeline entirely. Nobody raises an indent for these: one storekeeper
     puts something on a lorry and another one counts it off. */
  Transfers: ['Transfer_ID','From_Site','To_Site','Item_Name','Part_Number','Unit','Section',
              'Quantity','Received_Qty','Status',
              'Sent_By_ID','Sent_By','Sent_At','Sent_Remarks',
              'Received_By_ID','Received_By','Received_At','Receive_Remarks',
              'Decided_By','Decided_At','Cancel_Reason','Item_Request_ID'],

  Sessions: ['Token','User_ID','Role','Created_At','Expires_At'],

  Settings: ['Key','Value','Description'],

  Sites: ['Site_Name','Active'],

  Sections: ['Site_Name','Section_Name','Active'],

  /* Nothing reaches an item list without the administrator. A store
     change — a new item or an edit to an existing one — lands here
     first, carrying both the before and the after so the admin can see
     exactly what would change. */
  Item_Requests: ['Request_ID','Site','Kind','Item_Code','Item_Name','Part_Number',
                  'Changes_JSON','Before_JSON','Indent_ID','Status',
                  'Requested_By_ID','Requested_By','Requested_At',
                  'Decided_By','Decided_At','Decision_Note']
};

/** The inventory tabs are declared per site, outside SCHEMA, because their
 *  names are data-driven. setupSystem creates them the same way. */
function inventorySchemas_() {
  var out = {};
  SITES.forEach(function (s) { out['INV_' + s] = INVENTORY_COLUMNS; });
  return out;
}

/** ------------------------------------------------------------------
 *  THE 10-STAGE PIPELINE
 *  Merges the PDF blueprint (store check / quotes / admin approval)
 *  with the Excel FMS (per-stage Planned / Actual / Status / Delay).
 *  tat = Turn-Around-Time in CALENDAR hours (24x7, as chosen).
 * ------------------------------------------------------------------ */
var STAGES = [
  { no:1,  key:'INDENT_RAISED',    name:'Indent Raised',              role:'USER',     tat:0,  colour:'#6366F1' },
  { no:2,  key:'STORE_VERIFY',     name:'Store Verification',         role:'STORE',    tat:12, colour:'#14B8A6' },
  { no:3,  key:'PURCHASE_MODE',    name:'Purchase / Quotations',      role:'PURCHASE', tat:24, colour:'#0EA5E9' },
  { no:4,  key:'ADMIN_APPROVAL',   name:'Admin Approval',             role:'ADMIN',    tat:12, colour:'#2563EB' },
  { no:5,  key:'SET_ETA',          name:'Set ETA & Logistics',        role:'PURCHASE', tat:12, colour:'#8B5CF6' },
  /* Chasing a dispatch is the one step two teams share: the purchase
     officer who placed the order, and the coordinator who chases it.
     Either may record the update. `role` stays the primary owner so
     older data and the timing sheet keep their meaning. */
  { no:6,  key:'FOLLOW_UP',        name:'Dispatch Follow-Up',         role:'PURCHASE', tat:24, colour:'#D946EF',
    alsoRoles:['PC'] },
  { no:7,  key:'RECEIVE_CHECK',    name:'Receive & Check Jaipur',     role:'STORE',    tat:32, colour:'#F59E0B' },
  /* Purchase could always send goods on (they may be the ones holding them). */
  { no:8,  key:'SEND_TO_STATION',  name:'Send To Station',            role:'STORE',    tat:16, colour:'#F97316',
    alsoRoles:['PURCHASE'] },
  { no:9,  key:'PLANT_RECEIVE',    name:'Plant Receipt & Check',      role:'STORE',    tat:16, colour:'#10B981' },
  { no:10, key:'CONFIRM_REQUEST',  name:'Confirm With Requester',     role:'USER',     tat:3,  colour:'#22C55E' }
];

/* ------------------------------------------------------------------
   WHO WORKS EACH STEP
   The administrator decides this under Settings: per step, which roles
   may act on it. Kept in the Settings tab as STAGE_ROLES_JSON, e.g.
   {"RECEIVE_CHECK":["STORE","PURCHASE"]}. A step not listed there keeps
   the defaults above (role + alsoRoles). The administrator can always act;
   step 1 (anyone raises) and step 10 (the requester closes) are fixed.
   ------------------------------------------------------------------ */
var EDITABLE_STAGES = ['STORE_VERIFY', 'PURCHASE_MODE', 'ADMIN_APPROVAL', 'SET_ETA', 'FOLLOW_UP',
                       'RECEIVE_CHECK', 'SEND_TO_STATION', 'PLANT_RECEIVE'];
/** Roles the administrator can hand a step to. USER is the requester's role: a
 *  requester only ever sees their own indents, so they cannot work a step. */
var STAGE_ROLE_CHOICES = ['STORE', 'PURCHASE', 'PC'];

var _STAGE_ROLES = null;
function stageRolesMap_() {
  if (_STAGE_ROLES) return _STAGE_ROLES;
  var map = {};
  try { map = JSON.parse(getSetting_('STAGE_ROLES_JSON') || '{}') || {}; } catch (e) { map = {}; }
  _STAGE_ROLES = map;
  return map;
}

function defaultStageRoles_(st) { return [st.role].concat(st.alsoRoles || []); }

/** Every role allowed to act on a step. */
function stageRoles_(st) {
  if (!st) return [];
  if (EDITABLE_STAGES.indexOf(st.key) !== -1) {
    var list = stageRolesMap_()[st.key];
    if (list && list.length) {
      var out = [];
      list.forEach(function (r) {
        r = String(r || '').toUpperCase().trim();
        if (STAGE_ROLE_CHOICES.indexOf(r) !== -1 && out.indexOf(r) === -1) out.push(r);
      });
      if (st.key === 'ADMIN_APPROVAL') out.unshift('ADMIN');   // approval stays the admin's
      if (out.length) return out;
    }
  }
  return defaultStageRoles_(st);
}

/** The stage list as the browser sees it, with who works each step today. */
function stagesOut_() {
  return STAGES.map(function (s) {
    var o = {};
    Object.keys(s).forEach(function (k) { o[k] = s[k]; });
    o.roles = stageRoles_(s);
    o.editable = EDITABLE_STAGES.indexOf(s.key) !== -1;
    return o;
  });
}
function roleOwnsStage_(role, st) {
  return stageRoles_(st).indexOf(String(role || '').toUpperCase()) !== -1;
}

var STATUS = {
  PENDING_STORE     : 'PENDING_STORE_VERIFICATION',
  ISSUED_FROM_STOCK : 'ISSUED_FROM_STOCK',
  SENT_TO_PURCHASE  : 'SENT_TO_PURCHASE',
  PENDING_APPROVAL  : 'PENDING_ADMIN_APPROVAL',
  APPROVED          : 'APPROVED_WAITING_DISPATCH',
  ETA_SET           : 'ETA_SET',
  IN_TRANSIT        : 'IN_TRANSIT',
  BOUGHT_AT_SHOP    : 'BOUGHT_AT_SHOP',
  RECEIVED_AT_HUB   : 'RECEIVED_AT_HUB',
  IN_TRANSIT_TO_PLANT: 'IN_TRANSIT_TO_PLANT',
  RECEIVED_AT_PLANT : 'RECEIVED_AT_PLANT',
  COMPLETED         : 'COMPLETED',
  REJECTED          : 'REJECTED',
  CANCELLED         : 'CANCELLED'
};

var ROLES = ['ADMIN','STORE','PURCHASE','PC','USER'];

/** Languages the app speaks. `code` is what is stored on the user. */
var LANGUAGES = [
  { code:'EN', label:'English',  native:'English', locale:'en-IN' },
  { code:'HI', label:'Hindi',    native:'हिन्दी',   locale:'hi-IN' }
];
function isLang_(c) {
  c = String(c || '').toUpperCase();
  for (var i = 0; i < LANGUAGES.length; i++) if (LANGUAGES[i].code === c) return true;
  return false;
}

/** Stage groups referenced by the workflow code. */
var STAGE_SET = {
  /** Everything after the store, skipped when stock is issued on the spot. */
  AFTER_STORE      : ['PURCHASE_MODE','ADMIN_APPROVAL','SET_ETA','FOLLOW_UP',
                      'RECEIVE_CHECK','SEND_TO_STATION','PLANT_RECEIVE'],
  /** Everything after approval, skipped when an indent is rejected. */
  AFTER_APPROVAL   : ['SET_ETA','FOLLOW_UP','RECEIVE_CHECK','SEND_TO_STATION',
                      'PLANT_RECEIVE','CONFIRM_REQUEST'],
  /** The hub leg — skipped entirely when goods ship straight to the plant. */
  HUB_LEG          : ['SEND_TO_STATION','PLANT_RECEIVE'],
  /** Bought over the counter: the purchaser already has the goods in hand, so
   *  approval, ETA, dispatch chasing and the inbound check are all moot. */
  SHOP_SKIP        : ['ADMIN_APPROVAL','SET_ETA','FOLLOW_UP','RECEIVE_CHECK']
};

/** How an indent got its go-ahead. */
var APPROVAL_ROUTE = {
  ADMIN     : 'ADMIN_APPROVED',
  DIRECT    : 'DIRECT_NO_APPROVAL',
  SHOP      : 'SHOP_PURCHASE'
};

/** Valid quality grades — quantity and quality are now checked together. */
var QC_GRADES = ['PERFECT','PARTIAL','DEFECTIVE'];

/** Photo kinds, and the label shown for each. */
/** The two roles that work the supply side rather than ask it for things.
 *  An indent one of them raises is a restocking order, not a request for
 *  something they personally need — which changes both where it starts and
 *  the question it closes with. */
var SUPPLY_ROLES = ['STORE', 'PURCHASE'];

function isSupplyRole_(role) {
  return SUPPLY_ROLES.indexOf(String(role || '').toUpperCase().trim()) !== -1;
}

/** Was this indent raised by the supply side? Read from the role recorded on
 *  the indent at the moment it was raised, never from the person's role now —
 *  a storekeeper who is later made a fitter must not change how their old
 *  indents close. Falls back to the Store_Action marker for rows written
 *  before this column existed. */
function raisedBySupply_(ind) {
  var stamped = safeStr_(ind.Raised_By_Role);
  if (stamped) return isSupplyRole_(stamped);
  return /^RAISED_BY_/.test(safeStr_(ind.Store_Action));
}

var PHOTO_KIND = {
  INDENT        : 'Indent photo',
  BILL          : 'Bill / invoice',
  MATERIAL      : 'Material photo',
  RECEIPT_HUB   : 'Hub receipt photo',
  RECEIPT_PLANT : 'Plant receipt photo',
  ETA           : 'Logistics photo',
  TRANSFER_OUT  : 'Material sent',
  TRANSFER_IN   : 'Material received'
};

/** ------------------------------------------------------------------
 *  LIVE NOTIFICATIONS
 *  Each event names who to tell and what to say. `to` is resolved by
 *  notifyTargets_(): a role name, REQUESTER, STAGE_OWNER or PC.
 * ------------------------------------------------------------------ */
var NOTIFY_EVENTS = {
  INDENT_RAISED   : { to:'STORE',       icon:'📝', title:'New indent raised',
                      line:'Check the stock and either issue it or forward it to purchase.' },
  SENT_TO_PURCHASE: { to:'PURCHASE',    icon:'🛒', title:'Forwarded to purchase',
                      line:'Not in stock. Take quotations or make a direct purchase.' },
  NEEDS_APPROVAL  : { to:'ADMIN',       icon:'✅', title:'Waiting for your approval',
                      line:'Quotations are in. Pick the one you are approving.' },
  APPROVED        : { to:'PURCHASE',    icon:'👍', title:'Approved — set the ETA',
                      line:'Enter the expected arrival and the delivery route.' },
  SENT_BACK       : { to:'PURCHASE',    icon:'↩️', title:'Sent back for re-quote',
                      line:'The admin wants this quoted again.' },
  REJECTED        : { to:'REQUESTER',   icon:'❌', title:'Your indent was rejected',
                      line:'' },
  ETA_SET         : { to:'STORE',       icon:'🚚', title:'Material on the way',
                      line:'An arrival date has been set. Watch for it.' },
  /* The next four go to whoever works the step the indent has just moved
     to, so a step handed to another team under Settings tells that team. */
  DISPATCHED      : { to:'STAGE_OWNER', icon:'📦', title:'Dispatched — expect delivery',
                      line:'Receive it and record the quantity and quality.' },
  RECEIVED_AT_HUB : { to:'STAGE_OWNER', icon:'🏢', title:'Received at the hub',
                      line:'Send it on to the plant with the vehicle details.' },
  AT_STATION      : { to:'STAGE_OWNER', icon:'🛣️', title:'On its way to the plant',
                      line:'Check it again when it arrives.' },
  READY_TO_CONFIRM: { to:'REQUESTER',   icon:'🎉', title:'Your material has arrived',
                      line:'Please confirm you have received it, so the indent can close.' },
  ISSUED_FROM_STOCK:{ to:'REQUESTER',   icon:'📤', title:'Issued from store stock',
                      line:'Collect it from the store and confirm in the app.' },
  CANCELLED       : { to:'REQUESTER',   icon:'🚫', title:'Indent cancelled', line:'' },
  FOLLOWUP        : { to:'STAGE_OWNER', icon:'📞', title:'Follow-up from the coordinator',
                      line:'' },
  REMINDER        : { to:'PC',          icon:'🔔', title:'Follow-up reminder', line:'' },
  OVERDUE         : { to:'STAGE_OWNER', icon:'⏰', title:'Overdue — still waiting on you',
                      line:'', alsoAdmin:true },
  BOUGHT_NO_APPROVAL:{ to:'ADMIN',      icon:'🧾', title:'Purchased without approval',
                      line:'For your records — the purchase team used their own authority.' },
  BOUGHT_AT_SHOP  : { to:'STAGE_OWNER', icon:'🛍️', title:'Bought over the counter',
                      line:'The purchaser has it in hand and is sending it to the station.' },
  ITEM_REQUEST    : { to:'ADMIN',       icon:'📋', title:'An item list change needs you',
                      line:'Nothing reaches an item list until you approve it.' },
  ITEM_DECIDED    : { to:'STORE',       icon:'📋', title:'Your item list change was decided',
                      line:'' },

  /* Site transfers. These are aimed at the OTHER site's store team, which
     is why the caller hands notify_ a stand-in carrying that site rather
     than the sending one. */
  TRANSFER_SENT     : { to:'STORE', icon:'🚚', title:'Material is on its way to you',
                        line:'Count it off the vehicle and receive it, so both shelves agree.' },
  TRANSFER_RECEIVED : { to:'STORE', icon:'✅', title:'Your transfer was received',
                        line:'It is on their shelf now and off yours.' },
  TRANSFER_CANCELLED: { to:'STORE', icon:'↩️', title:'A transfer was cancelled',
                        line:'The quantity has gone back on the sending site\'s shelf.' }
};

/** Events that are on unless the admin turns them off. */
var NOTIFY_DEFAULTS = (function () {
  var o = {};
  Object.keys(NOTIFY_EVENTS).forEach(function (k) { o[k] = true; });
  return o;
})();

var STOCK_TXN = {
  ISSUED           : 'ISSUED',
  PURCHASED_AT_SHOP: 'PURCHASED_AT_SHOP',
  RECEIVED_AT_HUB  : 'RECEIVED_AT_HUB',
  RECEIVED_AT_PLANT: 'RECEIVED_AT_PLANT',
  OPENING          : 'OPENING_STOCK',
  ADJUSTED         : 'ADJUSTED',
  /* What the person who raised the indent actually walked away with. The
     rest of a larger order stays on the shelf. */
  TAKEN_BY_REQUESTER: 'TAKEN_BY_REQUESTER',
  RETURNED_TO_STOCK : 'RETURNED_TO_STOCK',
  /* Goods moving between two sites. Both halves move a shelf, but neither
     is consumption — nothing was used up, it is the same goods in a
     different building, and counting it as use would inflate the average
     daily consumption at one site and starve it at the other. */
  TRANSFER_OUT      : 'TRANSFER_OUT',
  TRANSFER_IN       : 'TRANSFER_IN'
};

/** Where a transfer has got to. */
var TRANSFER_STATUS = {
  IN_TRANSIT    : 'IN_TRANSIT',
  AWAITING_ITEM : 'AWAITING_ITEM',   // counted in, waiting for the admin to list the item
  RECEIVED      : 'RECEIVED',
  CANCELLED     : 'CANCELLED'
};

/* ------------------------------------------------------------------
   Not every ledger row is a movement. Two of them are CHECKPOINTS —
   they record a count at a moment, but the goods are not on the site
   yet, so the shelf figure must not change:

     RECEIVED_AT_HUB     counted at an intermediate hub, still in transit.
                         It lands on the shelf at the plant check.
     PURCHASED_AT_SHOP   bought over a counter and carried. It lands on
                         the shelf when it is checked in at the plant.

   Treating either as an inbound movement would count the same goods
   twice. Rows now carry Moves_Stock so the distinction is visible in
   the sheet; this list is the fallback for rows written before that.
   ------------------------------------------------------------------ */
var STOCK_TXN_CHECKPOINT = ['RECEIVED_AT_HUB', 'PURCHASED_AT_SHOP'];
function txnMovesStock_(type) {
  return STOCK_TXN_CHECKPOINT.indexOf(String(type || '').toUpperCase()) === -1;
}

/** Which stage keys each role may see in HISTORY -------------------- */
var HISTORY_SCOPE = {
  ADMIN    : '*',
  STORE    : ['STORE_VERIFY','RECEIVE_CHECK','SEND_TO_STATION','PLANT_RECEIVE','STOCK'],
  PURCHASE : ['INDENT_RAISED','PURCHASE_MODE','ADMIN_APPROVAL','SET_ETA','FOLLOW_UP','QUOTE'],
  PC       : ['FOLLOWUP','REMINDER'],
  USER     : 'OWN'
};

/** Default editable settings --------------------------------------- */
var DEFAULT_SETTINGS = [
  ['ORG_NAME','GG Minerals','Shown in the app header'],
  ['REMINDER_EMAIL_ENABLED','TRUE','Send email at reminder time'],
  ['REMINDER_CALENDAR_ENABLED','TRUE','Create Google Calendar event (phone push)'],
  ['STAGE_TAT_JSON', JSON.stringify(
      STAGES.reduce(function (o, s) { o[s.key] = s.tat; return o; }, {})),
    'Turn-around-time per stage, in hours'],
  ['ALERT_RED_HOURS','24','Hours past planned time before an indent turns RED'],
  ['MAX_QUOTES','5','Maximum competitive quotations per indent'],
  ['TELEGRAM_ENABLED','FALSE','Send live Telegram notifications'],
  ['TELEGRAM_BOT_USERNAME','','Your bot handle, without the @'],
  ['NOTIFY_EVENTS_JSON', JSON.stringify(NOTIFY_DEFAULTS), 'Which notifications are switched on'],
  ['OVERDUE_ALERT_EVERY_HOURS','12','Hours between repeat nudges on the same overdue indent'],
  ['APP_URL','','Web app /exec link, used for the button in each notification'],
  ['DIRECT_PURCHASE_LIMIT','0',
   'Rupee ceiling the purchase team may spend without admin approval. 0 = no ceiling.'],
  ['IMS_PUSH_ENABLED','FALSE',
   'TRUE = also write every stock movement to that site IMS sheet. Keep FALSE while the store teams fill the IMS sheets by hand, or movements are counted twice.']
];
