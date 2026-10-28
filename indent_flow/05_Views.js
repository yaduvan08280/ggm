/**********************************************************************
 * File: 05_Views.gs  —  Everything the browser reads: dashboards,
 *                       indent detail, role-scoped history, masters.
 *********************************************************************/

/** Serialise an indent row for transport (all dates become ISO strings). */
function shapeIndent_(ind) {
  return {
    id: ind.Indent_ID, timestamp: iso_(ind.Timestamp),
    requesterId: ind.Requester_ID, requestedBy: ind.Requested_By,
    site: ind.Site, section: safeStr_(ind.Section), plant: ind.Site,
    requestedQty: safeStr_(ind.Requested_Qty) || safeStr_(ind.Quantity),
    requesterReceivedQty: safeStr_(ind.Requester_Received_Qty),
    parentIndentId: safeStr_(ind.Parent_Indent_ID),
    splitReason: safeStr_(ind.Split_Reason),
    partNumber: safeStr_(ind.Part_Number), partName: ind.Part_Name,
    quantity: safeStr_(ind.Quantity), unit: safeStr_(ind.Unit),
    description: safeStr_(ind.Description), photoUrl: safeStr_(ind.Photo_URL),
    priority: safeStr_(ind.Priority) || 'NORMAL',
    currentStage: ind.Current_Stage, status: ind.Status,
    stageEnteredAt: iso_(ind.Stage_Entered_At), stagePlannedAt: iso_(ind.Stage_Planned_At),
    storeAction: safeStr_(ind.Store_Action), issuedQty: safeStr_(ind.Issued_Qty),
    storeRemarks: safeStr_(ind.Store_Remarks),
    purchaseMode: safeStr_(ind.Purchase_Mode), purchaser: safeStr_(ind.Purchaser),
    finalVendor: safeStr_(ind.Final_Vendor), finalAmount: safeStr_(ind.Final_Amount),
    approvedBy: safeStr_(ind.Approved_By), approvedAt: iso_(ind.Approved_At),
    approvalRoute: safeStr_(ind.Approval_Route),
    shopName: safeStr_(ind.Shop_Name), shopBillNo: safeStr_(ind.Shop_Bill_No),
    shopPurchaseAt: iso_(ind.Shop_Purchase_At),
    fromShop: String(ind.Destination_Type) === 'FROM_SHOP',
    eta: iso_(ind.ETA), destinationType: safeStr_(ind.Destination_Type),
    primaryLocation: safeStr_(ind.Primary_Location), secondaryLocation: safeStr_(ind.Secondary_Location),
    transitEta: iso_(ind.Transit_ETA), dispatchStatus: safeStr_(ind.Dispatch_Status),
    vehicleDetails: safeStr_(ind.Vehicle_Details),
    billPhotoUrl: safeStr_(ind.Bill_Photo_URL),
    materialPhotoUrl: safeStr_(ind.Material_Photo_URL),
    firstReceiptPhotoUrl: safeStr_(ind.First_Receipt_Photo_URL),
    plantReceiptPhotoUrl: safeStr_(ind.Plant_Receipt_Photo_URL),
    firstReceiptLocation: safeStr_(ind.First_Receipt_Location),
    firstReceivedQty: safeStr_(ind.First_Received_Qty),
    firstQcResult: safeStr_(ind.First_QC_Result),
    firstQcRemarks: safeStr_(ind.First_QC_Remarks),
    firstReceivedAt: iso_(ind.First_Received_At),
    receivedQty: safeStr_(ind.Received_Qty),
    qcResult: safeStr_(ind.QC_Result), qcRemarks: safeStr_(ind.QC_Remarks),
    finalReceiptLocation: safeStr_(ind.Final_Receipt_Location),
    viaHub: String(ind.Destination_Type) === 'VIA_HUB',
    confirmedBy: safeStr_(ind.Confirmed_By), remarks: safeStr_(ind.Remarks),
    createdAt: iso_(ind.Created_At), updatedAt: iso_(ind.Updated_At),
    completedAt: iso_(ind.Completed_At),
    totalCycleMins: blankNum_(ind.Total_Cycle_Mins), totalDelayMins: blankNum_(ind.Total_Delay_Mins)
  };
}

function isClosed_(status) {
  return [STATUS.COMPLETED, STATUS.REJECTED, STATUS.CANCELLED].indexOf(String(status)) !== -1;
}

var _RED_MINS = null;
function redMins_() {
  if (_RED_MINS === null) _RED_MINS = num_(getSetting_('ALERT_RED_HOURS'), 24) * 60;
  return _RED_MINS;
}
var _TAT_MEMO = null;
function tatMap_() {
  if (_TAT_MEMO) return _TAT_MEMO;
  _TAT_MEMO = {};
  STAGES.forEach(function (st) { _TAT_MEMO[st.key] = tatFor_(st.key); });
  return _TAT_MEMO;
}

/** ON_TIME / DUE_SOON / DELAYED / CRITICAL for an open indent. */
function health_(ind, nowMs) {
  if (isClosed_(ind.Status)) {
    return { level: 'CLOSED', stuckMins: 0, overdueMins: num_(ind.Total_Delay_Mins, 0) };
  }
  var entered = toDate_(ind.Stage_Entered_At);
  var planned = toDate_(ind.Stage_Planned_At);
  var stuck   = entered ? Math.round((nowMs - entered.getTime()) / 60000) : 0;
  if (!planned) return { level: 'ON_TIME', stuckMins: stuck, overdueMins: 0 };
  var over = Math.round((nowMs - planned.getTime()) / 60000);
  var redMins = redMins_();
  var level = over > redMins ? 'CRITICAL'
            : over > 0       ? 'DELAYED'
            : (planned.getTime() - nowMs) < (0.25 * Math.max(1, (planned.getTime() - (entered ? entered.getTime() : nowMs))))
                             ? 'DUE_SOON' : 'ON_TIME';
  return { level: level, stuckMins: stuck, overdueMins: Math.max(0, over) };
}

/** The two receipt stages read differently depending on the route taken. */
function stageLabel_(key, ind) {
  var viaHub = ind && String(ind.Destination_Type) === 'VIA_HUB';
  var hub    = ind ? safeStr_(ind.Secondary_Location) : '';
  var plant  = ind ? (safeStr_(ind.Primary_Location) || safeStr_(ind.Site)) : '';
  if (key === 'RECEIVE_CHECK') {
    if (ind && String(ind.Destination_Type) === 'FROM_SHOP') return 'Receive & Check (not needed)';
    if (!ind || !safeStr_(ind.Destination_Type)) return 'Receive & Check (Qty + Quality)';
    return viaHub ? ('Receive & Check at Hub' + (hub ? ' — ' + hub : ''))
                  : ('Receive & Check at Plant' + (plant ? ' — ' + plant : ''));
  }
  if (key === 'SEND_TO_STATION' && ind && String(ind.Destination_Type) === 'FROM_SHOP') {
    return 'Send To Station — from ' + (safeStr_(ind.Shop_Name) || 'the shop');
  }
  if (key === 'PLANT_RECEIVE') {
    return 'Plant Receipt & Check' + (plant ? ' — ' + plant : '');
  }
  var s = stageByKey_(key);
  return s ? s.name : key;
}

/** The stage timeline of one indent, ready for the UI rail. */
function timeline_(indentId, nowMs, ind) {
  return stageRowsFor_(indentId).map(function (r) {
    var st = stageByKey_(r.Stage_Key) || {};
    var entered = toDate_(r.Entered_At);
    var planned = toDate_(r.Planned_At);
    var done    = toDate_(r.Completed_At);
    var live    = (String(r.Status) === 'PENDING' && entered)
                  ? Math.round((nowMs - entered.getTime()) / 60000) : null;
    var liveDelay = (String(r.Status) === 'PENDING' && planned && nowMs > planned.getTime())
                  ? Math.round((nowMs - planned.getTime()) / 60000) : 0;
    return {
      no: num_(r.Stage_No), key: r.Stage_Key, name: stageLabel_(r.Stage_Key, ind),
      ownerRole: r.Owner_Role, ownerRoles: ownerRolesFor_(st, r.Owner_Role), colour: st.colour || '#64748B',
      tatHours: tatMap_()[r.Stage_Key],
      enteredAt: iso_(r.Entered_At), plannedAt: iso_(r.Planned_At), completedAt: iso_(r.Completed_At),
      completedBy: safeStr_(r.Completed_By_Name), status: r.Status,
      durationMins: done ? num_(r.Duration_Mins, 0) : live,
      delayMins: done ? num_(r.Delay_Mins, 0) : liveDelay,
      note: safeStr_(r.Note)
    };
  });
}

/** Who works a step today, for the role pills on the timeline. */
function ownerRolesFor_(st, stored) {
  if (!st || !st.key) return stored ? [String(stored)] : [];
  if (st.key === 'CONFIRM_REQUEST' || st.key === 'INDENT_RAISED') return ['USER'];
  return stageRoles_(st);
}

/* ================================================================== */
/*  Indent lists                                                       */
/* ================================================================== */

function listIndents_(token, f) {
  var actor = requireAuth_(token);
  f = f || {};
  // Health depends on the clock, so bucket the cache key to 20-second slices:
  // repeated polls in the same slice are free, and it can never be stale by more.
  return cached_('li_' + actor.User_ID + '_' + JSON.stringify(f) + '_' +
                 Math.floor(Date.now() / 20000), 20, function () {
    return listIndentsFresh_(actor, f);
  });
}

function listIndentsFresh_(actor, f) {
  var role  = String(actor.Role).toUpperCase();
  var nowMs = Date.now();

  var rows = readAll_(SH.INDENTS);

  if (role === 'USER') {
    rows = rows.filter(function (r) { return String(r.Requester_ID) === String(actor.User_ID); });
  }
  if (role === 'STORE') {
    // A storekeeper sees only their own site's traffic.
    rows = rows.filter(function (r) { return sameSite_(actor, r); });
  }
  if (role === 'PC' && f.scope !== 'ALL') {
    rows = rows.filter(function (r) { return !isClosed_(r.Status); });
  }
  if (f.scope === 'ACTIVE')    rows = rows.filter(function (r) { return !isClosed_(r.Status); });
  if (f.scope === 'CLOSED')    rows = rows.filter(function (r) { return isClosed_(r.Status); });
  if (f.scope === 'MY_QUEUE')  rows = rows.filter(function (r) { return waitingOn_(actor, r); });
  var wantSite = f.site || f.plant;
  if (wantSite) rows = rows.filter(function (r) { return String(r.Site).toUpperCase() === String(wantSite).toUpperCase(); });
  if (f.section) rows = rows.filter(function (r) { return String(r.Section).toUpperCase() === String(f.section).toUpperCase(); });
  if (f.stage)  rows = rows.filter(function (r) { return String(r.Current_Stage) === String(f.stage); });
  if (f.status) rows = rows.filter(function (r) { return String(r.Status) === String(f.status); });
  if (f.health) {
    var wanted = String(f.health).toUpperCase();
    rows = rows.filter(function (r) {
      var lvl = health_(r, nowMs).level;
      // "DELAYED" on the dashboard means anything past its due time
      if (wanted === 'DELAYED') return lvl === 'DELAYED' || lvl === 'CRITICAL';
      return lvl === wanted;
    });
  }
  if (f.q) {
    var q = String(f.q).toLowerCase();
    rows = rows.filter(function (r) {
      return [r.Indent_ID, r.Part_Name, r.Part_Number, r.Requested_By, r.Site, r.Section,
              r.Final_Vendor, r.Description].join(' ').toLowerCase().indexOf(q) !== -1;
    });
  }

  // newest first; each date is worked out once, not once per comparison
  var when = {};
  rows.forEach(function (r) {
    var d = toDate_(r.Created_At) || toDate_(r.Timestamp);
    when[r.__row] = d ? d.getTime() : 0;
  });
  rows.sort(function (a, b) { return when[b.__row] - when[a.__row]; });

  var limit = num_(f.limit, 300);
  var sliced = rows.slice(0, limit);

  return {
    total: rows.length,
    rows: sliced.map(function (r) {
      var o = shapeIndent_(r);
      var h = health_(r, nowMs);
      o.health = h.level; o.stuckMins = h.stuckMins; o.overdueMins = h.overdueMins;
      o.canAct = canActOn_(actor, r);
      var st = stageByKey_(r.Current_Stage);
      o.currentStageName = st ? stageLabel_(st.key, r) : (isClosed_(r.Status) ? 'Closed' : r.Current_Stage);
      o.currentStageNo   = st ? st.no : 0;
      return o;
    })
  };
}

/** May this user perform the action that the indent is currently waiting on? */
function canActOn_(actor, ind) {
  if (isClosed_(ind.Status)) return false;
  var role = String(actor.Role).toUpperCase();
  if (role === 'ADMIN') return true;
  var st = stageByKey_(ind.Current_Stage);
  if (!st) return false;
  // The coordinator watches everything but only acts on the steps she shares.
  if (role === 'PC') return roleOwnsStage_('PC', st);
  // A storekeeper only handles goods for their own site.
  if (roleNeedsSite_(role) && !sameSite_(actor, ind)) return false;
  if (st.key === 'CONFIRM_REQUEST') return String(ind.Requester_ID) === String(actor.User_ID);
  return roleOwnsStage_(role, st);   // who works which step is set under Settings
}

/** Is this indent waiting on this person — their "Waiting on me" count, the
 *  Approvals / My queue badge and list, and the portal tile's number?
 *
 *  The administrator CAN act on any step (canActOn_), but what is waiting on
 *  them is only the steps that are theirs: Admin Approval (step 4), plus any
 *  step the Settings screen hands to the admin. Everyone else: exactly what
 *  they can act on. */
function waitingOn_(actor, ind) {
  if (String(actor.Role).toUpperCase() !== 'ADMIN') return canActOn_(actor, ind);
  if (isClosed_(ind.Status)) return false;
  return roleOwnsStage_('ADMIN', stageByKey_(ind.Current_Stage));
}

/** True when the indent belongs to the site this person is attached to.
 *  Somebody who works across all four sites always matches. */
function sameSite_(actor, ind) {
  var mine = String(actor.Site || '').toUpperCase().trim();
  if (!mine || mine === SITE_ALL) return true;
  return mine === String(ind.Site || '').toUpperCase().trim();
}

/* ==================================================================
   Who to chase
   ------------------------------------------------------------------
   The coordinator's board says "chase these people". It used to list
   everybody holding the step's ROLE, anywhere — so a Newai indent stuck
   at store verification told her to ring the Tonk storekeeper, who
   cannot see it, cannot act on it, and has nothing to do with it.

   The list is now built from canActOn_ itself: the only people named are
   the people who can actually press the button. The two can never drift
   apart, because they are the same question asked once.

   That gives the site rule for free — a person attached to a site only
   handles that site's goods; a person on ALL sites appears on every
   site's indents — and it gives the shared steps for free too (dispatch
   follow-up belongs to purchase AND the coordinator, so both are named),
   and at the closing step it names the one person who raised it.
   ================================================================== */
function stageOwnersFor_(ind, st, users) {
  if (!st) return [];
  users = users || readAll_(SH.USERS);
  return users.filter(function (u) {
    if (!truthy_(u.Active)) return false;
    /* The administrator can act on anything, which is not the same as
       being the person to chase. Name them only on the step that is
       genuinely theirs, or every card would say "chase the admin". */
    if (String(u.Role).toUpperCase() === 'ADMIN' && !roleOwnsStage_('ADMIN', st)) return false;
    return canActOn_(u, ind);
  });
}

/** Full detail for one indent. Like the lists, the answer is kept for the
 *  same 20-second slice and data version, so opening it again is instant. */
function getIndent_(token, indentId) {
  var actor = requireAuth_(token);
  return cached_('gi_' + actor.User_ID + '_' + safeStr_(indentId) + '_' +
                 Math.floor(Date.now() / 20000), 20, function () {
    return getIndentFresh_(actor, indentId);
  });
}

function getIndentFresh_(actor, indentId) {
  var ind = getIndentOrThrow_(indentId);
  if (String(actor.Role).toUpperCase() === 'USER' && String(ind.Requester_ID) !== String(actor.User_ID)) {
    throw new Error('You can only open indents that you raised.');
  }
  var nowMs = Date.now();
  var o = shapeIndent_(ind);
  var h = health_(ind, nowMs);
  o.health = h.level; o.stuckMins = h.stuckMins; o.overdueMins = h.overdueMins;
  o.canAct = canActOn_(actor, ind);

  /* What is on the shelf for this exact item, right now, at this indent's
     site. Read live rather than remembered, because the whole point is to
     tell the storekeeper what is there at the moment they are deciding. */
  var r = findItem_(ind.Site, ind.Part_Name, ind.Part_Number);
  o.stockNow = r
    ? (function () { var it = shapeItem_(r, String(ind.Site).toUpperCase()); it.known = true; return it; })()
    : { known: false, site: String(ind.Site || '').toUpperCase(),
        name: safeStr_(ind.Part_Name), stock: 0, unit: safeStr_(ind.Unit) };

  // the ceiling on what the requester may say they took
  o.availableQty = availableToTake_(ind);

  /* A restocking indent closes with a different question, so the drawer needs
     the pieces that question is built from: who it could go to, and how much
     there is to give. Only sent when it is actually the closing step, because
     nothing else on the screen has any use for it. */
  o.restocking = raisedBySupply_(ind);
  o.raisedByRole = safeStr_(ind.Raised_By_Role);
  o.issuedToName = safeStr_(ind.Issued_To_Name);
  if (o.restocking && String(ind.Current_Stage) === 'CONFIRM_REQUEST') {
    var shelf = shelfFor_(ind.Site, ind.Part_Name, ind.Part_Number);
    o.onShelf = shelf.listed ? num_(shelf.stock, 0) : 0;
    o.shelfListed = !!shelf.listed;
    o.giveCeiling = o.onShelf + num_(ind.Issued_Qty, 0);
    o.people = peopleFor_(ind.Site);
  }

  /* Both ends of a split, so whoever opens either half can see the other.
     A partly-bought indent is only honest if the shortfall is findable. */
  o.remainders = readWhere_(SH.INDENTS, function (r) {
    return String(r.Parent_Indent_ID) === String(ind.Indent_ID);
  }).map(function (r) {
    return { id: safeStr_(r.Indent_ID), quantity: safeStr_(r.Quantity),
             unit: safeStr_(r.Unit), status: safeStr_(r.Status),
             currentStage: safeStr_(r.Current_Stage), reason: safeStr_(r.Split_Reason) };
  });
  if (o.parentIndentId) {
    var par = findBy_(SH.INDENTS, 'Indent_ID', o.parentIndentId);
    o.parent = par ? { id: safeStr_(par.Indent_ID), quantity: safeStr_(par.Quantity),
                       unit: safeStr_(par.Unit), status: safeStr_(par.Status),
                       shopName: safeStr_(par.Shop_Name) } : null;
  }

  var st = stageByKey_(ind.Current_Stage);
  o.currentStageName = st ? stageLabel_(st.key, ind) : (isClosed_(ind.Status) ? 'Closed' : ind.Current_Stage);
  o.currentStageNo   = st ? st.no : 0;

  /* The people who can actually move this indent along right now. The
     coordinator's follow-up dialog offers them first, so ringing the right
     person is the default rather than a hunt through everybody in the
     company. Built after `st` is resolved, because it is the step that
     decides who is holding it. */
  o.owners = stageOwnersFor_(ind, st, null).map(function (u) {
    return { id: safeStr_(u.User_ID), name: safeStr_(u.Name), role: safeStr_(u.Role),
             phone: safeStr_(u.Phone), site: safeStr_(u.Site) };
  });

  return {
    indent   : o,
    timeline : timeline_(ind.Indent_ID, nowMs, ind),
    quotes   : readWhere_(SH.QUOTES, function (q) { return String(q.Indent_ID) === String(ind.Indent_ID); })
                 .map(shapeQuote_),
    stock    : readWhere_(SH.STOCK, function (s) { return String(s.Indent_ID) === String(ind.Indent_ID); })
                 .map(function (s) {
                   return { id: s.Transaction_ID, type: s.Transaction_Type, qty: safeStr_(s.Quantity),
                            site: s.Site, location: s.Site,
                            balanceAfter: safeStr_(s.Balance_After),
                            actor: s.Actor_Name, at: iso_(s.Timestamp),
                            remarks: safeStr_(s.Remarks) };
                 }),
    attachments: readWhere_(SH.ATTACH, function (a) { return String(a.Indent_ID) === String(ind.Indent_ID); })
                 .map(shapeAttachment_)
                 .filter(function (a) { return canSeePhoto_(actor, a); }),
    followups: readWhere_(SH.FOLLOWUPS, function (fu) { return String(fu.Indent_ID) === String(ind.Indent_ID); })
                 .map(shapeFollowup_),
    /* A requester follows their indent by the ten step tiles, which say
       where it is and what is left. The line-by-line log underneath is the
       working record of who did what — names, amounts, vendors, reasons —
       and it is not theirs to read. It is withheld here rather than hidden
       in the browser, so it never leaves the server in the first place. */
    history  : String(actor.Role).toUpperCase() === 'USER' ? []
               : readWhere_(SH.HISTORY, function (l) { return String(l.Indent_ID) === String(ind.Indent_ID); })
                   .map(shapeLog_)
                   .sort(function (a, b) { return (a.at < b.at) ? 1 : -1; })
  };
}

/** Everyone an item could be handed to, this site's people first.
 *
 *  A storekeeper handing out a bearing is nearly always handing it to
 *  somebody on their own site, so those names come first and the rest are
 *  kept underneath rather than removed — the unusual case still has to be
 *  possible. Each name carries its role and site so two Rameshes are
 *  telling apart.
 */
function peopleFor_(site) {
  var here = String(site || '').toUpperCase().trim();
  var mine = [], others = [];
  readAll_(SH.USERS).forEach(function (u) {
    if (!truthy_(u.Active)) return;
    var us = String(u.Site || '').toUpperCase().trim();
    var row = {
      id: safeStr_(u.User_ID), name: safeStr_(u.Name),
      role: safeStr_(u.Role), site: us,
      allSites: !us || us === SITE_ALL
    };
    if (us === here) mine.push(row); else others.push(row);
  });
  function byName(a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; }
  mine.sort(byName); others.sort(byName);
  return { site: here, here: mine, elsewhere: others };
}

/* ==================================================================
   Who may open which photograph
   ------------------------------------------------------------------
   A storekeeper's business with an indent is the goods: what was asked
   for, and what turned up. The bill is not their business — it carries
   the vendor's rate, and knowing what the plant pays is the purchase
   team's and the administrator's affair. So the store sees the photo the
   requester attached when they raised it, and whatever the store itself
   photographed, and nothing else.

   The requester sees their own photo and the goods, because the point of
   showing them anything is so they can say "that is not what I asked for"
   — and again, never a bill.
   ================================================================== */
var PHOTO_FOR_STORE     = ['INDENT'];
var PHOTO_FOR_REQUESTER = ['INDENT', 'MATERIAL', 'RECEIPT_HUB', 'RECEIPT_PLANT'];

function canSeePhoto_(actor, a) {
  var role = String(actor.Role).toUpperCase();
  if (role === 'ADMIN' || role === 'PURCHASE' || role === 'PC') return true;

  var kind = String(a.kind || '').toUpperCase();
  // whatever this person photographed themselves is always theirs to open
  if (String(a.by || '') === String(actor.Name || '') && a.by) return true;

  if (role === 'STORE') return PHOTO_FOR_STORE.indexOf(kind) !== -1;
  return PHOTO_FOR_REQUESTER.indexOf(kind) !== -1;
}

function shapeQuote_(q) {
  return {
    id: q.Quotation_ID, indentId: q.Indent_ID, vendorId: safeStr_(q.Vendor_ID),
    vendor: q.Vendor_Name, brand: safeStr_(q.Brand),
    pricePerUnit: num_(q.Price_Per_Unit, 0), quantity: safeStr_(q.Quantity),
    totalAmount: num_(q.Total_Amount, 0), deliveryDays: safeStr_(q.Delivery_Days),
    remarks: safeStr_(q.Remarks), status: q.Status,
    createdBy: safeStr_(q.Created_By), createdAt: iso_(q.Created_At),
    decidedBy: safeStr_(q.Decided_By), decidedAt: iso_(q.Decided_At)
  };
}

function shapeLog_(l) {
  return {
    id: l.Log_ID, at: iso_(l.Timestamp), indentId: l.Indent_ID,
    stageKey: safeStr_(l.Stage_Key), stageName: safeStr_(l.Stage_Name),
    action: l.Action, category: l.Category,
    actorId: l.Actor_ID, actor: l.Actor_Name, actorRole: l.Actor_Role,
    from: safeStr_(l.From_Status), to: safeStr_(l.To_Status),
    details: safeStr_(l.Details), notes: safeStr_(l.Notes)
  };
}

/* ================================================================== */
/*  Dashboard summary                                                  */
/* ================================================================== */

function dashboard_(token) {
  var actor = requireAuth_(token);
  return cached_('db_' + actor.User_ID + '_' + Math.floor(Date.now() / 20000), 20, function () {
    return dashboardFresh_(actor);
  });
}

function dashboardFresh_(actor) {
  var role  = String(actor.Role).toUpperCase();
  var nowMs = Date.now();
  var all   = readAll_(SH.INDENTS);
  var scope = (role === 'USER')
    ? all.filter(function (r) { return String(r.Requester_ID) === String(actor.User_ID); })
    : all;

  var counts = { total: scope.length, active: 0, completed: 0, cancelled: 0, rejected: 0,
                 delayed: 0, critical: 0, dueSoon: 0, myQueue: 0 };
  var byStage = {};
  STAGES.forEach(function (s) { byStage[s.key] = { key: s.key, no: s.no, name: s.name, colour: s.colour, count: 0, delayed: 0 }; });

  scope.forEach(function (r) {
    var st = String(r.Status);
    if (st === STATUS.COMPLETED)       counts.completed++;
    else if (st === STATUS.CANCELLED)  counts.cancelled++;
    else if (st === STATUS.REJECTED)   counts.rejected++;
    else {
      counts.active++;
      var h = health_(r, nowMs);
      if (h.level === 'CRITICAL') { counts.critical++; counts.delayed++; }
      else if (h.level === 'DELAYED') counts.delayed++;
      else if (h.level === 'DUE_SOON') counts.dueSoon++;
      if (byStage[r.Current_Stage]) {
        byStage[r.Current_Stage].count++;
        if (h.level === 'DELAYED' || h.level === 'CRITICAL') byStage[r.Current_Stage].delayed++;
      }
      if (waitingOn_(actor, r)) counts.myQueue++;
    }
  });

  var out = {
    counts: counts,
    byStage: STAGES.map(function (s) { return byStage[s.key]; }),
    role: role,
    user: publicUser_(actor)
  };

  /* Item-list changes waiting on the administrator. The store sees only
     its own site's, because that is all it can ask for. */
  if (role === 'ADMIN' || role === 'STORE') {
    var site = String(actor.Site || '').toUpperCase().trim();
    counts.itemReq = readWhere_(SH.ITEM_REQ, function (r) {
      if (String(r.Status) !== 'PENDING') return false;
      if (role === 'STORE' && String(r.Site || '').toUpperCase().trim() !== site) return false;
      return true;
    }).length;
  }

  /* Goods standing on a lorry with this person's name on them. */
  if (role === 'STORE') counts.transfers = incomingTransferCount_(actor);

  /* How many items across every site this person can see are at or below
     their own reorder point — the number on the Reorder List tile. */
  if (role === 'ADMIN' || role === 'STORE' || role === 'PURCHASE') {
    // reading the whole ledger and every item list is the dearest part of the
    // dashboard, and it only changes when stock does: kept until then
    var mySites = sitesVisibleTo_(actor);
    var invTabs = [SH.STOCK].concat(siteList_().map(invSheet_).filter(String));
    counts.reorder = tabCached_(invTabs, 'reorder_' + mySites.join('-'), 600, function () {
      var totals = ledgerTotals_();
      return mySites.reduce(function (n, st2) {
        return n + invRows_(st2).filter(function (r) {
          var b = shapeItem_(r, st2, totals).band;
          return b === 'OUT' || b === 'CRITICAL' || b === 'LOW';
        }).length;
      }, 0);
    });
  }

  if (role === 'PC') {
    var fus = readAll_(SH.FOLLOWUPS);
    out.pc = {
      followupsTotal: fus.length,
      followupsToday: fus.filter(function (f) {
        var d = toDate_(f.Created_At); if (!d) return false;
        return d.toDateString() === new Date().toDateString();
      }).length,
      remindersPending: readWhere_(SH.REMINDERS, function (r) { return String(r.Status) === 'SCHEDULED'; }).length
    };
  }
  return out;
}

/* ================================================================== */
/*  Process-Coordinator board                                          */
/* ================================================================== */

function pcBoard_(token, f) {
  var actor = requireAuth_(token);
  var role  = String(actor.Role).toUpperCase();
  if (['PC', 'ADMIN'].indexOf(role) === -1) throw new Error('Only the process coordinator or an admin can open this board.');
  f = f || {};
  return cached_('pb_' + actor.User_ID + '_' + JSON.stringify(f) + '_' +
                 Math.floor(Date.now() / 20000), 20, function () {
    return pcBoardFresh_(actor, f);
  });
}

function pcBoardFresh_(actor, f) {
  var nowMs = Date.now();

  var rows = readAll_(SH.INDENTS).filter(function (r) { return !isClosed_(r.Status); });
  var wantSite = f.site || f.plant;
  if (wantSite) rows = rows.filter(function (r) { return String(r.Site).toUpperCase() === String(wantSite).toUpperCase(); });
  if (f.section) rows = rows.filter(function (r) { return String(r.Section).toUpperCase() === String(f.section).toUpperCase(); });
  if (f.stage)  rows = rows.filter(function (r) { return String(r.Current_Stage) === String(f.stage); });
  if (f.health) rows = rows.filter(function (r) { return health_(r, nowMs).level === f.health; });

  var allFu   = readAll_(SH.FOLLOWUPS);
  var allRem  = readAll_(SH.REMINDERS);
  var allStg  = readAll_(SH.STAGES);
  var users   = readAll_(SH.USERS);

  var byIndentStages = {};
  allStg.forEach(function (s) {
    (byIndentStages[s.Indent_ID] = byIndentStages[s.Indent_ID] || []).push(s);
  });

  var out = rows.map(function (r) {
    var h  = health_(r, nowMs);
    var st = stageByKey_(r.Current_Stage);
    var mine = (byIndentStages[r.Indent_ID] || []).slice()
                 .sort(function (a, b) { return num_(a.Stage_No) - num_(b.Stage_No); });

    var tl = mine.map(function (row) {
      var entered = toDate_(row.Entered_At);
      var planned = toDate_(row.Planned_At);
      var done    = toDate_(row.Completed_At);
      var stDef   = stageByKey_(row.Stage_Key) || {};
      var live    = (String(row.Status) === 'PENDING' && entered)
                    ? Math.round((nowMs - entered.getTime()) / 60000) : null;
      var liveDelay = (String(row.Status) === 'PENDING' && planned && nowMs > planned.getTime())
                    ? Math.round((nowMs - planned.getTime()) / 60000) : 0;
      return {
        no: num_(row.Stage_No), key: row.Stage_Key, name: stageLabel_(row.Stage_Key, r),
        ownerRole: row.Owner_Role, ownerRoles: ownerRolesFor_(stDef, row.Owner_Role),
        colour: stDef.colour || '#64748B', status: row.Status,
        enteredAt: iso_(row.Entered_At), plannedAt: iso_(row.Planned_At), completedAt: iso_(row.Completed_At),
        completedBy: safeStr_(row.Completed_By_Name),
        durationMins: done ? num_(row.Duration_Mins, 0) : live,
        delayMins: done ? num_(row.Delay_Mins, 0) : liveDelay
      };
    });

    var fus = allFu.filter(function (x) { return String(x.Indent_ID) === String(r.Indent_ID); })
                   .sort(function (a, b) { return (toDate_(b.Created_At) || 0) - (toDate_(a.Created_At) || 0); });
    var rems = allRem.filter(function (x) {
      return String(x.Indent_ID) === String(r.Indent_ID) && String(x.Status) === 'SCHEDULED';
    }).sort(function (a, b) { return (toDate_(a.Remind_At) || 0) - (toDate_(b.Remind_At) || 0); });

    // Who is holding it up right now?
    var ownerRole = st ? ownerRolesFor_(st, '').join(' / ') : '';
    var owners = stageOwnersFor_(r, st, users)
      .map(function (u) { return safeStr_(u.Name) + (u.Phone ? ' (' + safeStr_(u.Phone) + ')' : ''); });

    return {
      id: r.Indent_ID, partName: r.Part_Name, partNumber: safeStr_(r.Part_Number),
      quantity: safeStr_(r.Quantity),
      requestedQty: safeStr_(r.Requested_Qty) || safeStr_(r.Quantity),
      parentIndentId: safeStr_(r.Parent_Indent_ID),
      site: r.Site, section: safeStr_(r.Section),
      plant: r.Site, requestedBy: r.Requested_By,
      priority: safeStr_(r.Priority) || 'NORMAL',
      status: r.Status, currentStage: r.Current_Stage,
      currentStageName: st ? stageLabel_(st.key, r) : r.Current_Stage,
      currentStageNo: st ? st.no : 0, ownerRole: ownerRole, owners: owners,
      raisedAt: iso_(r.Created_At), stageEnteredAt: iso_(r.Stage_Entered_At),
      stagePlannedAt: iso_(r.Stage_Planned_At), eta: iso_(r.ETA),
      vendor: safeStr_(r.Final_Vendor),
      viaHub: String(r.Destination_Type) === 'VIA_HUB',
      hub: safeStr_(r.Secondary_Location),
      firstReceiptLocation: safeStr_(r.First_Receipt_Location),
      health: h.level, stuckMins: h.stuckMins, overdueMins: h.overdueMins,
      timeline: tl,
      followupCount: fus.length,
      lastFollowup: fus.length ? shapeFollowup_(fus[0]) : null,
      nextReminder: rems.length ? { id: rems[0].Reminder_ID, at: iso_(rems[0].Remind_At), note: safeStr_(rems[0].Note) } : null
    };
  });

  out.sort(function (a, b) {
    var rank = { CRITICAL: 0, DELAYED: 1, DUE_SOON: 2, ON_TIME: 3 };
    var d = (rank[a.health] === undefined ? 4 : rank[a.health]) - (rank[b.health] === undefined ? 4 : rank[b.health]);
    if (d !== 0) return d;
    return b.overdueMins - a.overdueMins;
  });

  return {
    rows: out,
    summary: {
      active  : out.length,
      critical: out.filter(function (x) { return x.health === 'CRITICAL'; }).length,
      delayed : out.filter(function (x) { return x.health === 'DELAYED'; }).length,
      dueSoon : out.filter(function (x) { return x.health === 'DUE_SOON'; }).length,
      onTime  : out.filter(function (x) { return x.health === 'ON_TIME'; }).length
    }
  };
}

/* ================================================================== */
/*  Role-scoped history                                                */
/* ================================================================== */

function getHistory_(token, f) {
  var actor = requireAuth_(token);
  var role  = String(actor.Role).toUpperCase();
  f = f || {};

  var logs   = readAll_(SH.HISTORY).map(shapeLog_);
  var extra  = {};
  var title  = 'History';
  var scope  = HISTORY_SCOPE[role];

  if (role === 'ADMIN') {
    title = 'Full System History — every step of every indent';
    extra.stock  = readAll_(SH.STOCK).map(shapeStock_);
    extra.quotes = readAll_(SH.QUOTES).map(shapeQuote_);
    extra.attachments = readAll_(SH.ATTACH).map(shapeAttachment_);
    extra.followups = readAll_(SH.FOLLOWUPS).map(shapeFollowup_);
    extra.reminders = readAll_(SH.REMINDERS).map(shapeReminder_);
  } else if (role === 'STORE') {
    title = 'Store History — verifications, goods received, dispatch & QC';
    logs = logs.filter(function (l) { return ['STORE'].indexOf(l.category) !== -1; });
    extra.stock = readAll_(SH.STOCK).map(shapeStock_);
    extra.attachments = readWhere_(SH.ATTACH, function (a) {
      return ['RECEIVE_CHECK', 'PLANT_RECEIVE', 'STORE_VERIFY'].indexOf(String(a.Stage_Key)) !== -1;
    }).map(shapeAttachment_);
  } else if (role === 'PURCHASE') {
    title = 'Purchase History — indents, quotations, approvals & purchases';
    logs = logs.filter(function (l) { return ['PURCHASE', 'APPROVAL', 'INDENT'].indexOf(l.category) !== -1; });
    extra.quotes = readAll_(SH.QUOTES).map(shapeQuote_);
    extra.attachments = readWhere_(SH.ATTACH, function (a) {
      return ['FOLLOW_UP', 'INDENT_RAISED'].indexOf(String(a.Stage_Key)) !== -1;
    }).map(shapeAttachment_);
  } else if (role === 'PC') {
    title = 'Follow-Up History';
    logs = logs.filter(function (l) { return ['FOLLOWUP', 'REMINDER'].indexOf(l.category) !== -1; });
    extra.followups = readAll_(SH.FOLLOWUPS).map(shapeFollowup_);
    extra.reminders = readAll_(SH.REMINDERS).map(shapeReminder_);
  } else { // USER
    title = 'My Indent History';
    var mine = {};
    readAll_(SH.INDENTS).forEach(function (r) {
      if (String(r.Requester_ID) === String(actor.User_ID)) mine[r.Indent_ID] = true;
    });
    logs = logs.filter(function (l) { return mine[l.indentId]; });
  }

  if (f.indentId) logs = logs.filter(function (l) { return String(l.indentId) === String(f.indentId); });
  if (f.from) { var fd = toDate_(f.from); if (fd) logs = logs.filter(function (l) { return l.at && new Date(l.at) >= fd; }); }
  if (f.to)   { var td = toDate_(f.to);   if (td) logs = logs.filter(function (l) { return l.at && new Date(l.at) <= td; }); }
  if (f.q) {
    var q = String(f.q).toLowerCase();
    logs = logs.filter(function (l) {
      return [l.indentId, l.action, l.actor, l.stageName, l.notes, l.details].join(' ').toLowerCase().indexOf(q) !== -1;
    });
  }

  logs.sort(function (a, b) { return (a.at < b.at) ? 1 : (a.at > b.at ? -1 : 0); });

  return { title: title, scope: scope, role: role,
           rows: logs.slice(0, num_(f.limit, 500)), total: logs.length, extra: extra };
}

function shapeAttachment_(a) {
  return { id: a.Attachment_ID, indentId: a.Indent_ID, stageKey: safeStr_(a.Stage_Key),
           stageName: safeStr_(a.Stage_Name), kind: a.Kind, label: safeStr_(a.Label),
           fileName: safeStr_(a.File_Name), url: a.URL,
           by: safeStr_(a.Uploaded_By), at: iso_(a.Uploaded_At) };
}

function shapeStock_(s) {
  return { id: s.Transaction_ID, indentId: s.Indent_ID, product: s.Product_Name,
           partNumber: safeStr_(s.Part_Number), qty: safeStr_(s.Quantity),
           type: s.Transaction_Type, site: s.Site, location: s.Site,
           balanceAfter: safeStr_(s.Balance_After),
           actor: s.Actor_Name, at: iso_(s.Timestamp), remarks: safeStr_(s.Remarks) };
}

/* ================================================================== */
/*  Master data                                                        */
/* ================================================================== */

function masters_(token) {
  var actor = requireAuth_(token);
  return cached_('ms_' + actor.User_ID + '_' + langOf_(actor), 120,
                 function () { return mastersFresh_(actor); });
}

function mastersFresh_(actor) {
  return {
    stages : stagesOut_(),
    stageRoleChoices: STAGE_ROLE_CHOICES,
    statuses: STATUS,
    sites  : siteList_(),
    siteTree: siteTree_(),
    plants : siteList_(),              // kept so an older browser tab keeps working
    vendors: readAll_(SH.VENDORS).filter(function (v) { return truthy_(v.Active); })
               .map(function (v) { return { id: v.Vendor_ID, name: v.Vendor_Name,
                                            contact: safeStr_(v.Contact_Person), phone: safeStr_(v.Phone),
                                            email: safeStr_(v.Email) }; }),
    people : readAll_(SH.USERS).filter(function (u) { return truthy_(u.Active); })
               .map(function (u) { return { id: u.User_ID, name: u.Name, role: u.Role,
                                            phone: safeStr_(u.Phone), site: u.Site, plant: u.Site }; }),
    settings: (String(actor.Role).toUpperCase() === 'ADMIN')
               ? readAll_(SH.SETTINGS).map(function (s) { return { key: s.Key, value: s.Value, description: s.Description }; })
               : [],
    orgName : getSetting_('ORG_NAME') || 'GG Minerals',
    languages: languages_(),
    lang    : langOf_(actor),
    directLimit: num_(getSetting_('DIRECT_PURCHASE_LIMIT'), 0),
    appName : APP.NAME, version: APP.VERSION
  };
}

function addVendor_(token, p) {
  var actor = requireRole_(token, ['PURCHASE', 'ADMIN']);
  var name = safeStr_(p.name);
  if (!name) throw new Error('Vendor name is required.');
  var exists = null;
  readAll_(SH.VENDORS).forEach(function (v) {
    if (!exists && String(v.Vendor_Name).toUpperCase() === name.toUpperCase()) exists = v;
  });
  if (exists) {
    update_(SH.VENDORS, exists.__row, {
      Contact_Person: safeStr_(p.contact) || exists.Contact_Person,
      Phone: safeStr_(p.phone) || exists.Phone,
      Email: safeStr_(p.email) || exists.Email,
      Active: 'TRUE'
    });
    return { id: exists.Vendor_ID, name: exists.Vendor_Name, created: false };
  }
  var id = nextId_(SH.VENDORS, 'Vendor_ID', 'VEN', 3);
  insert_(SH.VENDORS, {
    Vendor_ID: id, Vendor_Name: name, Contact_Person: safeStr_(p.contact),
    Phone: safeStr_(p.phone), Email: safeStr_(p.email),
    Category: safeStr_(p.category) || 'GENERAL', Active: 'TRUE',
    Created_By: actor.Name, Created_At: now_()
  });
  return { id: id, name: name, created: true };
}

function saveSetting_(token, p) {
  requireRole_(token, ['ADMIN']);
  var key = safeStr_(p.key);
  if (!key) throw new Error('Setting key is required.');
  if (key === 'STAGE_ROLES_JSON') throw new Error('Change who works each step on the Settings screen.');
  setSetting_(key, p.value, safeStr_(p.description));
  return { key: key, value: p.value };
}

/** Several settings in one go (the Settings screen's "Save settings"), under
 *  the lock, so two keys added together cannot land on the same row. */
function saveSettings_(token, p) {
  requireRole_(token, ['ADMIN']);
  var list = (p && p.items) || [];
  return withLock_(function () {
    list.forEach(function (it) {
      var key = safeStr_(it.key);
      if (!key || key === 'STAGE_ROLES_JSON') return;
      setSetting_(key, it.value, '');
    });
    return { saved: list.length };
  });
}

/** Step times and who works each step, saved together. */
function saveStages_(token, p) {
  requireRole_(token, ['ADMIN']);
  var tat = {}, roles = {};
  STAGES.forEach(function (s) {
    var h = p && p.tat ? p.tat[s.key] : undefined;
    if (h !== undefined && h !== null && h !== '') {
      var n = Number(h);
      if (isNaN(n) || n < 0) throw new Error('Hours for "' + s.name + '" must be 0 or more.');
      tat[s.key] = n;
    }
    if (EDITABLE_STAGES.indexOf(s.key) === -1) return;
    var want = (p && p.roles && p.roles[s.key]) || [];
    var clean = [];
    want.forEach(function (r) {
      r = String(r || '').toUpperCase().trim();
      if (STAGE_ROLE_CHOICES.indexOf(r) !== -1 && clean.indexOf(r) === -1) clean.push(r);
    });
    if (!clean.length && s.key !== 'ADMIN_APPROVAL') {
      throw new Error('"' + s.name + '" needs at least one team, or nobody but the administrator could do it.');
    }
    roles[s.key] = clean;
  });
  withLock_(function () {
    setSetting_('STAGE_TAT_JSON', JSON.stringify(tat), 'Turn-around-time per stage, in hours');
    setSetting_('STAGE_ROLES_JSON', JSON.stringify(roles), 'Which roles work each step (set on the Settings screen)');
  });
  _STAGE_ROLES = null; _TAT_MEMO = null;
  return { stages: stagesOut_() };
}
