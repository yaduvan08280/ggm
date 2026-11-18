/*******************************************************
 * Leads & Orders — marketing pipeline board. The whole backend is this app's own spreadsheet:
 *
 *   LEADS    Leads → Order       (copied once from 01.LEADS TO ORDER FMS)
 *   ORDERS   Order → Delivery    (copied once from 2. ORDER TO DELIVERY FLOW CHART)
 *   Steps · Holidays · Events · Notes · Photos · Lead State · Activity · Settings
 *
 * LEADS / ORDERS keep the FMS layout (row 2 What · 3 Who · 4 How · 5 When (hours) ·
 * 6 headings · data from row 7) with plain values only. The app writes Planned /
 * Actual / Status / Time Delay and the step fields there. Everything is entered in
 * the app (no Google Forms); the old FMS sheets are never read or written again.
 *******************************************************/

var APP = { id: 'LEADS', name: 'Leads & Orders' };

/** The two flows. Heading names are matched case-insensitively and trimmed. */
var FLOWS = {
  L2O: {
    id: 'L2O', title: 'Leads → Order', short: 'Leads', unit: 'lead',
    ssId: '', tab: 'LEADS',
    legacy: { ssId: '1PzNOLkhslDCgy6v_SZhsKQABG0vy2aFKHuxvPV26Xuw', tab: 'LEADS TO ORDER FMS', form: 'Form responses 1' },
    owner: 'ATT. NAME', titles: ['Company Name', 'CONTACT PERSON'], sub: 'CONTACT PERSON',
    category: 'Product Category', material: 'PRODUCT NAME', qty: 'QUANTITY',
    source: 'SOURCE', market: 'EXP. / DOM', place: 'COUNTRY / CITY', phone: 'Contact Details'
  },
  O2D: {
    id: 'O2D', title: 'Order → Delivery', short: 'Orders', unit: 'order',
    ssId: '', tab: 'ORDERS',
    legacy: { ssId: '1xe2PTcNPxf3uDFJq2ITlbG96QoLZUCCTG6ZQVhsjgWM', tab: 'FMS', form: 'Form responses 1' },
    owner: 'SALES PER.', titles: ['PARTY NAME'], sub: 'Mines/Factory',
    category: 'Mat. Gr.', material: 'Mat. Gr.', qty: 'QTY.',
    source: 'Mines/Factory', market: '', place: '', phone: ''
  },
  /**
   * Order cycles (17 Nov 2026): after the estimate an order is sent in cycles. Each cycle = a payment
   * (advance / credit / on dispatch / on delivery, covering some tons) → trucks → dispatch → payment
   * confirmation → invoice → delivery → balance payment call. Shown on the Order → Delivery board.
   */
  CYC: {
    id: 'CYC', title: 'Order cycles', short: 'Cycles', unit: 'cycle', parent: 'O2D',
    ssId: '', tab: 'CYCLES',
    owner: 'SALES PER.', titles: ['PARTY NAME'], sub: 'Order No',
    category: 'Mat. Gr.', material: 'Mat. Gr.', qty: '',
    source: 'Mines/Factory', market: '', place: '', phone: ''
  }
};
/** CYC joins once the CYCLES tab exists (?cycles=1 sets CYCLES_ON). */
var FLOW_IDS = ['L2O', 'O2D'].concat(PropertiesService.getScriptProperties().getProperty('CYCLES_ON') ? ['CYC'] : []);
var ROW = { WHAT: 2, WHO: 3, HOW: 4, WHEN: 5, HEAD: 6, FIRST: 7 };

/** App spreadsheet tabs (created by setup / on first use). */
var TABS = {
  EVENTS:   { name: 'Events',     head: ['Time', 'User', 'Name', 'Flow', 'Lead', 'Step', 'Action', 'Value', 'To Step', 'On Time', 'Late Hrs', 'Owner User', 'Detail'] },
  NOTES:    { name: 'Notes',      head: ['Time', 'User', 'Name', 'Flow', 'Lead', 'Step', 'Note'] },
  PHOTOS:   { name: 'Photos',     head: ['Time', 'User', 'Name', 'Flow', 'Lead', 'Step', 'File ID', 'Thumb', 'Caption'] },
  STATE:    { name: 'Lead State', head: ['Flow', 'Lead', 'Key', 'Value', 'Time', 'User'] },
  ACTIVITY: { name: 'Activity',   head: ['Date', 'User', 'Name', 'Opens', 'Active Secs', 'First', 'Last', 'Actions'] },
  SETTINGS: { name: 'Settings',   head: ['Key', 'Value', 'Changed By', 'Changed At'] },
  // Telegram (Notify.js)
  TELEGRAM:   { name: 'Telegram',   head: ['Username', 'Name', 'Chat ID', 'Telegram name', 'Linked at'] },
  REMINDERS:  { name: 'Reminders',  head: ['ID', 'Username', 'Name', 'What to do', 'When', 'Repeat', 'Flow', 'Lead', 'Status', 'Created', 'Last sent'] },
  NOTIFY_LOG: { name: 'Notify Log', head: ['Time', 'Username', 'Kind', 'Key', 'Message', 'Result'] },
  // Order cycles (Cycles.js): one row per truck; a removed truck keeps its row with "Removed" filled
  TRUCKS:     { name: 'Trucks',     head: ['Cycle No', 'Order No', 'Truck No.', 'Transporter', 'Driver Mob.', 'Weight (t)', 'Added', 'Added By', 'Removed'] }
};

/** How a cycle is paid for. "Advance received" is always allowed; the others only for customers the Admin allows. */
var CYCLE_TERMS = ['Advance received', 'Credit', 'On Dispatch', 'On Delivery'];
/** Steps without a deadline (the order waits while its cycles run). */
var NO_CLOCK = { O2D: { CYCLES: 1 } };
/** Fields the app fills itself (shown read-only). */
var APP_FIELDS = { O2D: { CYCLES: ['Loaded (t)', 'Balance (t)', 'Cycles'] }, CYC: { TRANSPORT: ['Trucks', 'Weight loaded (t)'] } };

var ROLES = ['Admin', 'Manager', 'Executive', 'Lead Generator', 'Order Generator'];
/** Form-only roles: they see nothing but the "new lead" / "new order" form of their flow. */
var GEN_FLOW = { leadgen: 'L2O', ordergen: 'O2D' };

var DEFAULT_LABELS = {
  L2O: { CONTACT: 'Contact & quote', QUOTATION: 'Give quotation', SAMPLING: 'Send sample', ADVANCE: 'Advance payment', FINAL: 'Final status' },
  O2D: { STATION: 'Confirm at station', CLIENT_OK: 'Client OK with availability', ESTIMATE: 'Send estimate / PI', ADVANCE: 'Advance payment',
         TRANSPORT: 'Arrange transport', S6A: 'Carry forward balance', DISPATCH: 'Dispatch', PAY_CONFIRM: 'Payment confirmation',
         INVOICE: 'Check & send invoice', DELIVERY: 'Confirm delivery', BALANCE_PAY: 'Balance payment call', CYCLES: 'In cycles' },
  CYC: { ADVANCE: 'Cycle payment', TRANSPORT: 'Trucks', DISPATCH: 'Dispatch', PAY_CONFIRM: 'Payment confirmation',
         INVOICE: 'Check & send invoice', DELIVERY: 'Confirm delivery', BALANCE_PAY: 'Balance payment call' }
};

/** What an answer does. Not listed = next step (the last step: done / won). */
var DEFAULT_RULES = {
  L2O: {
    // Contact & quote (16 Nov 2026: Contact buyer + Give quotation are one step)
    CONTACT:   { 'CNR': 'stay', 'BUSY/Not Reachable': 'stay', 'Cut The Call': 'stay', 'Wrong Number': 'lost', 'Close Inquiry': 'lost',
                 'Rate Issue': 'stay', 'Quality Issue': 'stay', 'Negotiating': 'stay', 'Order Reject': 'lost' },
    QUOTATION: { 'Rate Issue': 'stay', 'Quality Issue': 'stay', 'Negotiating': 'stay', 'Order Reject': 'lost' },
    FINAL:     { 'SUCCESS': 'won', 'FAILED': 'lost' }
  },
  O2D: {
    STATION:   { 'No': 'stay' },
    CLIENT_OK: { 'No': 'back:STATION' },
    ESTIMATE:  { 'Rate Issue': 'stay', 'Quality Issue': 'stay', 'Negotiating': 'stay', 'Order Reject': 'lost' },
    DISPATCH:  { 'No': 'stay' }
  },
  CYC: {
    DISPATCH:  { 'No': 'stay' }
  }
};

/** A saved field value that sends the lead back (e.g. the sample failed → send it again). */
var DEFAULT_FIELD_RULES = {
  L2O: [
    { step: 'SAMPLING', field: 'Sample Status', values: ['Failed', 'Req. Another Sample'], action: 'back:SAMPLING' },
    { step: 'SAMPLING', field: 'DELIVERY STATUS', values: ['Un Delivered'], action: 'back:SAMPLING' }
  ],
  O2D: []
};

/** What a tile shows at each step (besides id, name, owner and the deadline). */
var DEFAULT_CARD = {
  L2O: {
    CONTACT:   ['base:CONTACT PERSON', 'base:Contact Details', 'base:PRODUCT NAME', 'base:QUANTITY', 'base:SOURCE', 'CONTACT:Raw Rates/Prices'],
    QUOTATION: ['base:PRODUCT NAME', 'base:QUANTITY', 'base:COUNTRY / CITY', 'CONTACT:REMARK'],
    SAMPLING:  ['base:PRODUCT NAME', 'base:QUANTITY', 'CONTACT:Raw Rates/Prices', 'CONTACT:REMARK'],
    ADVANCE:   ['base:PRODUCT NAME', 'base:QUANTITY', 'SAMPLING:@status', 'SAMPLING:Sample Status'],
    FINAL:     ['base:PRODUCT NAME', 'base:QUANTITY', 'ADVANCE:@status']
  },
  O2D: {
    STATION:     ['base:Mines/Factory', 'base:Mat. Gr.', 'base:QTY.', 'base:EST. DEL. Dt.'],
    CLIENT_OK:   ['base:Mat. Gr.', 'base:QTY.', 'STATION:EDD', 'STATION:Prev. Dt.'],
    ESTIMATE:    ['base:Mat. Gr.', 'base:QTY.', 'CLIENT_OK:Remark'],
    ADVANCE:     ['base:Mat. Gr.', 'base:QTY.', 'ESTIMATE:@status'],
    TRANSPORT:   ['base:Mines/Factory', 'base:QTY.', 'STATION:Prev. Dt.', 'ADVANCE:Payment Term'],
    S6A:         ['TRANSPORT:Balance WT.', 'base:Mat. Gr.'],
    DISPATCH:    ['base:Mines/Factory', 'TRANSPORT:TPT. NAME', 'TRANSPORT:VEH.', 'TRANSPORT:WT.'],
    PAY_CONFIRM: ['base:QTY.', 'ADVANCE:Payment Term', 'TRANSPORT:WT.'],
    INVOICE:     ['base:QTY.', 'TRANSPORT:WT.'],
    DELIVERY:    ['TRANSPORT:VEH.', 'TRANSPORT:MOB.', 'DISPATCH:Act. Date'],
    BALANCE_PAY: ['ADVANCE:Payment Term', 'base:QTY.'],
    CYCLES:      ['base:QTY.', 'CYCLES:Loaded (t)', 'CYCLES:Balance (t)', 'CYCLES:Cycles']
  },
  CYC: {
    ADVANCE:     ['base:Mat. Gr.', 'base:Mines/Factory'],
    TRANSPORT:   ['ADVANCE:@status', 'ADVANCE:Tons covered', 'TRANSPORT:Weight loaded (t)'],
    DISPATCH:    ['TRANSPORT:Trucks', 'TRANSPORT:Weight loaded (t)'],
    PAY_CONFIRM: ['ADVANCE:@status', 'TRANSPORT:Weight loaded (t)'],
    INVOICE:     ['TRANSPORT:Weight loaded (t)', 'DISPATCH:Dispatch Date'],
    DELIVERY:    ['TRANSPORT:Trucks', 'DISPATCH:Dispatch Date'],
    BALANCE_PAY: ['ADVANCE:@status', 'INVOICE:Invoice No.']
  }
};

var DEFAULT_REQUIRED = {
  L2O: { CONTACT: ['CONTACT:Raw Rates/Prices'] },
  O2D: { STATION: ['STATION:Prev. Dt.'], TRANSPORT: ['TRANSPORT:TPT. NAME', 'TRANSPORT:VEH.'] },
  CYC: { ADVANCE: ['ADVANCE:Tons covered'], DISPATCH: ['DISPATCH:Dispatch Date'] }
};

/** Steps that run beside the main line and only show when a field says so. */
var DEFAULT_SIDE = { O2D: { S6A: 'TRANSPORT:Balance WT.' } };

/** Steps where a photo makes sense (the camera button is shown first there). */
var DEFAULT_PHOTO_STEPS = { L2O: ['SAMPLING', 'ADVANCE'], O2D: ['STATION', 'ADVANCE', 'TRANSPORT', 'DISPATCH', 'PAY_CONFIRM', 'INVOICE', 'DELIVERY'] , CYC: ['ADVANCE', 'TRANSPORT', 'DISPATCH', 'PAY_CONFIRM', 'INVOICE', 'DELIVERY'] };

var DEFAULT_INDUSTRIES = ['Ceramics & tiles', 'Paints & coatings', 'Paper', 'Plastics & polymers', 'Soap & detergent', 'Foundry',
  'Cosmetics', 'Agriculture & fertiliser', 'Construction', 'Glass', 'Rubber', 'Pharma', 'Trader / reseller', 'Other'];

/** Points. Positive = good work, negative = things that went wrong. Admin can change them in Settings. */
var DEFAULT_SCORES = {
  step_on_time:   { pts: 10,  label: 'Step done on time' },
  step_late:      { pts: 3,   label: 'Step done late (still done)' },
  late_hour:      { pts: -1,  label: 'Each working hour late (max -15 a step)' },
  follow_up:      { pts: 1,   label: 'Follow-up logged (call not answered, negotiating…)' },
  note:           { pts: 1,   label: 'Note added (max 10 a day)' },
  photo:          { pts: 1,   label: 'Photo added (max 10 a day)' },
  lead_created:   { pts: 2,   label: 'New lead entered' },
  order_created:  { pts: 5,   label: 'Won lead turned into an order' },
  won:            { pts: 25,  label: 'Lead won / order completed (owner)' },
  lost:           { pts: -5,  label: 'Lead lost (owner)' },
  rework:         { pts: -8,  label: 'Your step had to be done again (sent back)' },
  overdue_day:    { pts: -2,  label: 'Tile still overdue at day end (each, each day)' },
  login_day:      { pts: 2,   label: 'Opened the app on a working day' },
  active_2h:      { pts: 3,   label: '2+ hours active in a day' },
  absent_day:     { pts: -3,  label: 'Working day without opening the app' }
};

var WARN_PCT = 30;   // amber when less than this % of the step's time is left
