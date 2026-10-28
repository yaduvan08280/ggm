/**********************************************************************
 * File: 04_Indents.gs  —  The indent lifecycle: creation, the ten
 *                         stage transitions, and stage timing books.
 *********************************************************************/

/* ================================================================== */
/*  Stage timing engine                                                */
/* ================================================================== */

/** Create the full 10-row timing skeleton for a brand-new indent. */
function seedStageRows_(indentId) {
  var rows = STAGES.map(function (s) {
    return {
      Row_ID: indentId + '#' + s.key, Indent_ID: indentId, Stage_No: s.no,
      Stage_Key: s.key, Stage_Name: s.name, Owner_Role: s.role,
      Entered_At: '', Planned_At: '', Completed_At: '', Completed_By: '', Completed_By_Name: '',
      Duration_Mins: '', Delay_Mins: '', Status: 'NOT_STARTED', Note: ''
    };
  });
  insertMany_(SH.STAGES, rows);
  return rows;
}

function stageRow_(indentId, key) {
  var rows = stageRowsFor_(indentId);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].Stage_Key) === String(key)) return rows[i];
  }
  return null;
}

/** One indent's timing rows.
 *
 *  Stage_Timings holds ten rows for every indent ever raised, and it was read
 *  whole on every step taken (twice: once to close the step, once to open the
 *  next). An indent's ten rows are written together, so they are found with a
 *  search and just that block is read. Anything unexpected falls back to the
 *  full read, which gives the same answer. */
function stageRowsFor_(indentId) {
  var id = String(indentId);
  var byNo = function (a, b) { return num_(a.Stage_No) - num_(b.Stage_No); };
  if (_MEMO[SH.STAGES]) {
    return readWhere_(SH.STAGES, function (r) { return String(r.Indent_ID) === id; }).sort(byNo);
  }
  var mk = '~st_' + id;                    // a '~' entry: any write to a tab retires it
  if (_MEMO[mk]) return _MEMO[mk];
  var rows = null;
  try {
    var sh = sheet_(SH.STAGES);
    var head = headers_(SH.STAGES);
    var col = head.indexOf('Indent_ID') + 1;
    var last = sh.getLastRow();
    if (col > 0 && last >= 2) {
      var hits = sh.getRange(2, col, last - 1, 1).createTextFinder(id).matchEntireCell(true).findAll();
      rows = [];
      if (hits.length) {
        var lo = Infinity, hi = 0;
        hits.forEach(function (c) { var r = c.getRow(); if (r < lo) lo = r; if (r > hi) hi = r; });
        var block = sh.getRange(lo, 1, hi - lo + 1, head.length).getValues();
        block.forEach(function (vals, i) {
          if (String(vals[col - 1]) !== id) return;
          var o = {};
          for (var c = 0; c < head.length; c++) o[head[c]] = vals[c];
          o.__row = lo + i;
          rows.push(o);
        });
      }
    } else if (last < 2) rows = [];
  } catch (e) { rows = null; }
  if (rows === null) {
    return readWhere_(SH.STAGES, function (r) { return String(r.Indent_ID) === id; }).sort(byNo);
  }
  rows.sort(byNo);
  _MEMO[mk] = rows;
  return rows;
}

/** Open a stage: stamp Entered_At and the planned (due) time. */
function openStage_(indentId, key, at) {
  var row = stageRow_(indentId, key);
  if (!row) return null;
  var planned = addHours_(at, tatFor_(key));
  update_(SH.STAGES, row.__row, {
    Entered_At: at, Planned_At: planned, Status: 'PENDING',
    Completed_At: '', Completed_By: '', Completed_By_Name: '',
    Duration_Mins: '', Delay_Mins: ''
  });
  return { entered: at, planned: planned };
}

/** Close a stage: stamp completion, duration and delay. */
function closeStage_(indentId, key, at, actor, note) {
  var row = stageRow_(indentId, key);
  if (!row) return null;
  var entered = toDate_(row.Entered_At) || at;
  var planned = toDate_(row.Planned_At);
  var delay   = (planned && at.getTime() > planned.getTime())
                ? Math.round((at.getTime() - planned.getTime()) / 60000) : 0;
  update_(SH.STAGES, row.__row, {
    Completed_At: at, Completed_By: actor.User_ID, Completed_By_Name: actor.Name,
    Duration_Mins: Math.round((at.getTime() - entered.getTime()) / 60000),
    Delay_Mins: delay, Status: 'DONE', Note: safeStr_(note)
  });
  return delay;
}

function skipStages_(indentId, keys, note) {
  var rows = stageRowsFor_(indentId);
  rows.forEach(function (r) {
    if (keys.indexOf(String(r.Stage_Key)) === -1) return;
    if (String(r.Status) === 'DONE') return;
    update_(SH.STAGES, r.__row, { Status: 'SKIPPED', Note: safeStr_(note) });
  });
}

/** Put stages back to NOT_STARTED (used when a route choice is changed). */
function unskipStages_(indentId, keys) {
  stageRowsFor_(indentId).forEach(function (r) {
    if (keys.indexOf(String(r.Stage_Key)) === -1) return;
    if (String(r.Status) !== 'SKIPPED') return;
    update_(SH.STAGES, r.__row, { Status: 'NOT_STARTED', Note: '' });
  });
}

/** Close `fromKey`, open `toKey`, and sync the indent header row. */
function advance_(indent, fromKey, toKey, actor, newStatus, patch, note) {
  var at = now_();
  if (fromKey) closeStage_(indent.Indent_ID, fromKey, at, actor, note);

  var p = patch || {};
  p.Status = newStatus;
  p.Updated_At = at;

  if (toKey) {
    var t = openStage_(indent.Indent_ID, toKey, at);
    p.Current_Stage     = toKey;
    p.Stage_Entered_At  = t ? t.entered : at;
    p.Stage_Planned_At  = t ? t.planned : '';
  } else {
    p.Current_Stage    = 'CLOSED';
    p.Stage_Entered_At = '';
    p.Stage_Planned_At = '';
    p.Completed_At     = at;
    var created = toDate_(indent.Created_At) || toDate_(indent.Timestamp) || at;
    p.Total_Cycle_Mins = Math.round((at.getTime() - created.getTime()) / 60000);
    p.Total_Delay_Mins = stageRowsFor_(indent.Indent_ID)
                          .reduce(function (s, r) { return s + num_(r.Delay_Mins, 0); }, 0);
  }
  update_(SH.INDENTS, indent.__row, p);
  return p;
}

/** Guard: the indent must currently be sitting on `expectKey`. */
function assertStage_(indent, expectKey) {
  var cur = String(indent.Current_Stage);
  if (cur !== expectKey) {
    var s = stageByKey_(cur);
    throw new Error('This indent is at "' + (s ? s.name : cur) +
                    '" — the "' + stageByKey_(expectKey).name + '" step is not open for it.');
  }
  if ([STATUS.COMPLETED, STATUS.REJECTED, STATUS.CANCELLED].indexOf(String(indent.Status)) !== -1) {
    throw new Error('This indent is already ' + indent.Status + '.');
  }
}

/** A storekeeper handles goods for their own site and nobody else's.
 *  People who work across all four sites pass straight through. */
function assertSameSite_(actor, indent) {
  var mine = String(actor.Site || '').toUpperCase().trim();
  if (!roleNeedsSite_(actor.Role) || !mine || mine === SITE_ALL) return;
  var theirs = String(indent.Site || '').toUpperCase().trim();
  if (mine !== theirs) {
    throw new Error(indent.Indent_ID + ' belongs to ' + (theirs || 'another site') +
                    ', and you look after ' + mine + '. Ask the ' + theirs +
                    ' store team to handle it.');
  }
}

function getIndentOrThrow_(indentId) {
  var ind = findBy_(SH.INDENTS, 'Indent_ID', safeStr_(indentId));
  if (!ind) throw new Error('Indent ' + indentId + ' not found.');
  return ind;
}

/* ================================================================== */
/*  History                                                            */
/* ================================================================== */

function logHistory_(indentId, stageKey, action, category, actor, from, to, details, notes) {
  var s = stageByKey_(stageKey);
  insert_(SH.HISTORY, {
    Log_ID: 'LOG-' + uuid_().slice(0, 8),
    Timestamp: now_(),
    Indent_ID: indentId,
    Stage_Key: stageKey,
    Stage_Name: s ? s.name : stageKey,
    Action: action,
    Category: category,
    Actor_ID: actor ? actor.User_ID : 'SYSTEM',
    Actor_Name: actor ? actor.Name : 'System',
    Actor_Role: actor ? actor.Role : 'SYSTEM',
    From_Status: safeStr_(from),
    To_Status: safeStr_(to),
    Details: details ? (typeof details === 'string' ? details : JSON.stringify(details)) : '',
    Notes: safeStr_(notes)
  });
}

/* ================================================================== */
/*  STAGE 1 — Raise an indent                                          */
/* ================================================================== */

function createIndent_(token, p) {
  var actor = requireAuth_(token);
  return withLock_(function () {
    var partName = safeStr_(p.partName);
    var qty      = safeStr_(p.quantity);
    if (!partName) throw new Error('Part / item name is required.');
    if (!qty)      throw new Error('Quantity is required.');
    /* C2 — the quantity travels the whole pipeline and lands in the stock
       ledger, so it has to be a real number from the moment it is typed. */
    var qtyN = Number(qty);
    if (isNaN(qtyN) || !isFinite(qtyN)) throw new Error('Quantity must be a number.');
    if (qtyN <= 0) throw new Error('Quantity must be more than zero.');

    /* The site is a property of the person, not of the form. A shop-floor
       user or a storekeeper can only ever raise an indent for their own site,
       so whatever the browser sends is ignored. Only the roles that work
       across all four sites (admin, purchase, coordinator) get to choose. */
    var site = siteForActor_(actor, p.site || p.siteName || p.plantName);
    var section = resolveSection_(site, p.section);

    var photoUrl = '';
    if (p.photo && p.photo.data) photoUrl = savePhoto_(p.photo, actor);

    var id = nextId_(SH.INDENTS, 'Indent_ID', 'IND', 4);
    var t  = now_();

    /* The store check exists to ask two people a question: does the shelf
       already have this, and is it worth buying? The storekeeper IS the first
       question and the purchase team IS the second — so when either of them
       raises the indent, the step would be them asking themselves, and it
       would sit in their own queue until they clicked it. It opens at
       purchase instead. Anyone else's indent still goes to the store first,
       because somebody has to look at the shelf before the money is spent. */
    var role        = String(actor.Role).toUpperCase();
    var bySupply    = isSupplyRole_(role);
    var firstStage  = bySupply ? 'PURCHASE_MODE' : 'STORE_VERIFY';
    var firstStatus = bySupply ? STATUS.SENT_TO_PURCHASE : STATUS.PENDING_STORE;

    var ind = {
      Indent_ID: id, Timestamp: t,
      Requester_ID: actor.User_ID, Requested_By: actor.Name,
      Site: site, Section: section,
      Part_Number: safeStr_(p.partNumber), Part_Name: partName,
      Quantity: qty,
      /* What the requester asked for. `Quantity` is what is actually
         ordered, which the store may raise to stock up — this one never
         moves, so the record always shows what was really needed. */
      Requested_Qty: qty,
      Requester_Received_Qty: '',
      Unit: safeStr_(p.unit) || 'NOS',
      Description: safeStr_(p.description), Photo_URL: photoUrl,
      Priority: (safeStr_(p.priority) || 'NORMAL').toUpperCase(),
      Current_Stage: firstStage, Status: firstStatus,
      Store_Action: bySupply ? ('RAISED_BY_' + role) : '', Issued_Qty: '', Store_Remarks: '',
      Purchase_Mode: '', Purchaser: '', Final_Vendor: '', Final_Amount: '',
      Approved_By: '', Approved_At: '',
      ETA: '', Destination_Type: '', Primary_Location: site,
      Secondary_Location: '', Transit_ETA: '', Dispatch_Status: '', Vehicle_Details: '',
      Received_Qty: '', QC_Result: '', QC_Remarks: '',
      Confirmed_By: '', Confirm_Remarks: '', Remarks: '',
      Created_At: t, Updated_At: t, Completed_At: '',
      Total_Cycle_Mins: '', Total_Delay_Mins: '',
      /* Stamped once, here. Every later decision about how this indent
         behaves reads this, not the person's role today. */
      Raised_By_Role: role
    };
    insert_(SH.INDENTS, ind);
    seedStageRows_(id);
    if (photoUrl) {
      insert_(SH.ATTACH, {
        Attachment_ID: 'ATT-' + uuid_().slice(0, 8), Indent_ID: id,
        Stage_Key: 'INDENT_RAISED', Stage_Name: 'Indent Raised',
        Kind: 'INDENT', Label: PHOTO_KIND.INDENT, File_Name: safeStr_(p.photo && p.photo.name),
        URL: photoUrl, Uploaded_By_ID: actor.User_ID, Uploaded_By: actor.Name, Uploaded_At: t
      });
    }

    // Stage 1 opens and closes in the same instant (the form submission is the act).
    openStage_(id, 'INDENT_RAISED', t);
    closeStage_(id, 'INDENT_RAISED', t, actor, 'Indent submitted');

    if (bySupply) {
      skipStages_(id, ['STORE_VERIFY'],
        role === 'STORE'
          ? 'Raised by the store itself, so there is nothing left to verify'
          : 'Raised by the purchase team, who are the next step anyway');
    }
    var s2 = openStage_(id, firstStage, t);
    update_(SH.INDENTS, ind.__row, {
      Stage_Entered_At: s2.entered, Stage_Planned_At: s2.planned
    });

    logHistory_(id, 'INDENT_RAISED',
      bySupply
        ? ('Indent raised by ' + (role === 'STORE' ? 'the store' : 'purchase') +
           ' — sent straight to purchase')
        : 'Indent raised',
      'INDENT', actor, '', firstStatus,
      { part: partName, qty: qty, site: site, section: section,
        raisedByRole: role, bySupply: bySupply },
      safeStr_(p.description));

    notify_('INDENT_RAISED', findBy_(SH.INDENTS, 'Indent_ID', id), { actorId: actor.User_ID });
    if (bySupply) {
      notify_('SENT_TO_PURCHASE', findBy_(SH.INDENTS, 'Indent_ID', id),
        { actorId: actor.User_ID,
          note: actor.Name + ' raised this from ' +
                (role === 'STORE' ? 'the store' : 'purchase') +
                ', so it comes straight to you.' });
    }

    return { indentId: id, status: firstStatus, stage: firstStage,
             raisedByRole: role, skippedStoreCheck: bySupply, photoUrl: photoUrl };
  });
}

/** The same, for a step that may carry none, one, or several. Returns the
 *  URLs that actually saved — a photo that fails to upload is dropped, never
 *  allowed to hold up the step it was attached to. */
function attachPhotos_(indentId, stageKey, kind, photos, actor) {
  var list = [];
  (photos || []).forEach(function (ph) {
    if (!ph || !ph.data) return;
    var url = attachPhoto_(indentId, stageKey, kind, ph, actor);
    if (url) list.push(url);
  });
  return list;
}

/** Save a photo, record it in the Attachments register, return its URL.
 *  A failed upload is never allowed to block the workflow step. */
function attachPhoto_(indentId, stageKey, kind, photo, actor) {
  if (!photo || !photo.data) return '';
  var url = savePhoto_(photo, actor);
  if (!url) return '';
  var st = stageByKey_(stageKey);
  insert_(SH.ATTACH, {
    Attachment_ID: 'ATT-' + uuid_().slice(0, 8),
    Indent_ID: indentId, Stage_Key: stageKey, Stage_Name: st ? st.name : stageKey,
    Kind: kind, Label: PHOTO_KIND[kind] || kind,
    File_Name: safeStr_(photo.name), URL: url,
    Uploaded_By_ID: actor.User_ID, Uploaded_By: actor.Name, Uploaded_At: now_()
  });
  return url;
}

/** Base64 -> Google Drive, returns a shareable view URL. */
function savePhoto_(photo, actor) {
  try {
    var folders = DriveApp.getFoldersByName(APP.DRIVE_FOLDER);
    var folder  = folders.hasNext() ? folders.next() : DriveApp.createFolder(APP.DRIVE_FOLDER);
    var bytes   = Utilities.base64Decode(photo.data);
    var blob    = Utilities.newBlob(bytes, photo.mimeType || 'image/jpeg',
                    (photo.name || 'indent-photo.jpg'));
    var file    = folder.createFile(blob);
    file.setDescription('Uploaded by ' + actor.Name + ' on ' + fmt_(now_()));
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    return 'https://drive.google.com/file/d/' + file.getId() + '/view';
  } catch (e) {
    // A photo must never block an indent from being raised.
    return '';
  }
}

/* ================================================================== */
/*  STAGE 2 — Store verification                                       */
/* ================================================================== */

/* ------------------------------------------------------------------
   The store's decision is ONE decision carrying TWO numbers:

       issueQty  what comes off the shelf and is handed over now
       orderQty  what purchase is asked to buy

   Three routes fall out of them, and nothing else is possible:

       I > 0, O = 0   issue only        → step 10, steps 3–9 skipped
       I > 0, O > 0   issue part, order → step 3, with I already handed over
       I = 0, O > 0   order only        → step 3, shelf untouched

   The guards below are the whole point. Before them the store could
   issue 50 from a shelf holding 1, and everything downstream inherited
   that as fact.
   ------------------------------------------------------------------ */
function storeAction_(token, p) {
  var actor = requireStageRole_(token, 'STORE_VERIFY');
  return withLock_(function () {
    var ind = getIndentOrThrow_(p.indentId);
    assertStage_(ind, 'STORE_VERIFY');
    assertSameSite_(actor, ind);

    var remarks = safeStr_(p.remarks);
    var asked   = safeStr_(ind.Requested_Qty) || ind.Quantity;
    var unit    = safeStr_(ind.Unit);
    var split   = storeSplit_(ind, p);          // validated { issue, order }

    /* ---------- what comes off the shelf, if anything ---------- */
    if (split.issue > 0) {
      adjustStock_(ind.Site, ind.Indent_ID, ind.Part_Name, ind.Part_Number,
                   -split.issue, STOCK_TXN.ISSUED, actor, remarks);
    }

    /* ---------- route A: issued in full, nothing to buy ---------- */
    if (split.order === 0) {
      skipStages_(ind.Indent_ID, STAGE_SET.AFTER_STORE, 'Fulfilled from existing stock');
      advance_(ind, 'STORE_VERIFY', 'CONFIRM_REQUEST', actor, STATUS.ISSUED_FROM_STOCK, {
        Store_Action: 'ISSUED_FROM_STOCK', Issued_Qty: split.issue, Store_Remarks: remarks,
        Quantity: split.issue,
        Received_Qty: split.issue, Final_Receipt_Location: ind.Site
      }, remarks);
      logHistory_(ind.Indent_ID, 'STORE_VERIFY', 'Issued from stock', 'STORE', actor,
        ind.Status, STATUS.ISSUED_FROM_STOCK,
        { issuedQty: split.issue, requestedQty: asked }, remarks);
      notify_('ISSUED_FROM_STOCK', findBy_(SH.INDENTS, 'Indent_ID', ind.Indent_ID),
        { actorId: actor.User_ID, note: remarks });
      return { status: STATUS.ISSUED_FROM_STOCK, nextStage: 'CONFIRM_REQUEST',
               issuedQty: split.issue, orderQty: 0 };
    }

    /* ---------- routes B and C: something goes to purchase ---------- */
    var partial = split.issue > 0;
    var changed = String(split.order).trim() !== String(asked).trim();

    advance_(ind, 'STORE_VERIFY', 'PURCHASE_MODE', actor, STATUS.SENT_TO_PURCHASE, {
      Store_Action: partial ? 'PART_ISSUED_PART_ORDERED' : 'FORWARDED_TO_PURCHASE',
      Issued_Qty: partial ? split.issue : '',
      Quantity: split.order,
      Store_Remarks: remarks
    }, remarks);

    var line = partial
      ? ('Issued ' + split.issue + ' ' + unit + ' from stock, ordered ' + split.order +
         ' (asked for ' + asked + ')')
      : (changed
          ? ('Forwarded to purchase — order raised from ' + asked + ' to ' + split.order + ' ' + unit)
          : 'Forwarded to purchase');

    logHistory_(ind.Indent_ID, 'STORE_VERIFY', line, 'STORE', actor,
      ind.Status, STATUS.SENT_TO_PURCHASE,
      { qty: split.order, issuedQty: split.issue, requestedQty: asked,
        quantityChanged: changed, partial: partial }, remarks);

    notify_('SENT_TO_PURCHASE', findBy_(SH.INDENTS, 'Indent_ID', ind.Indent_ID),
      { actorId: actor.User_ID, note: remarks });

    return { status: STATUS.SENT_TO_PURCHASE, nextStage: 'PURCHASE_MODE',
             issuedQty: split.issue, orderQty: split.order, partial: partial };
  });
}

/* ==================================================================
   Naming an item the store does not recognise
   ------------------------------------------------------------------
   A fitter types "conveyer moter"; the store knows it as "Conveyor motor
   1.5 kW". Correcting that at the store step is right, and it is the only
   step at which the goods have not been bought yet.

   But the moment the typed name DOES match the item list, the name is no
   longer free text — it is the key the whole ledger is filed under. Every
   stock figure, every reorder point and every past movement hangs off it,
   so renaming it here would silently point this indent at a different
   shelf, or at nothing at all. That is why the rename is refused outright
   rather than merely warned about.
   ================================================================== */
function relabelIndentItem_(token, p) {
  var actor = requireStageRole_(token, 'STORE_VERIFY');
  return withLock_(function () {
    var ind = getIndentOrThrow_(p.indentId);
    assertStage_(ind, 'STORE_VERIFY');
    assertSameSite_(actor, ind);

    var name = safeStr_(p.name);
    var part = p.partNumber === undefined ? safeStr_(ind.Part_Number) : safeStr_(p.partNumber);
    if (!name) throw new Error('The item needs a name.');

    var was = safeStr_(ind.Part_Name);
    var listed = findItem_(ind.Site, was, ind.Part_Number);
    if (listed) {
      throw new Error('"' + safeStr_(listed.Item_Name) + '" is already on the ' + ind.Site +
                      ' item list, and the stock figures are filed under that name. ' +
                      'Rename it under Stock if the name itself is wrong — changing it here ' +
                      'would point this indent at a different shelf.');
    }
    if (name === was && part === safeStr_(ind.Part_Number)) {
      return { indentId: ind.Indent_ID, name: name, partNumber: part, changed: false };
    }

    /* The new name may well be one the store already keeps — that is the
       usual reason for correcting it — so from here on the indent is an
       ordinary listed-item indent. */
    var nowListed = findItem_(ind.Site, name, part);

    update_(SH.INDENTS, ind.__row, {
      Part_Name: name, Part_Number: part,
      Unit: nowListed ? (safeStr_(nowListed.Unit) || safeStr_(ind.Unit)) : safeStr_(ind.Unit),
      Updated_At: now_()
    });
    logHistory_(ind.Indent_ID, 'STORE_VERIFY',
      'Item renamed from "' + was + '" to "' + name + '"', 'STORE', actor,
      ind.Status, ind.Status,
      { from: was, to: name, partNumber: part, matchedList: !!nowListed }, safeStr_(p.remarks));

    return { indentId: ind.Indent_ID, name: name, partNumber: part,
             changed: true, listed: !!nowListed,
             unit: nowListed ? safeStr_(nowListed.Unit) : safeStr_(ind.Unit) };
  });
}

/** Read and validate the store's two numbers. Throws a readable error the
 *  moment any of S1–S4 fails, so nothing is ever half-applied.
 *  Older callers that send { action:'ISSUE' | 'FORWARD' } still work. */
function storeSplit_(ind, p) {
  var asked = num_(ind.Quantity, 0);
  var issue, order;

  if (p.issueQty !== undefined || p.orderQty !== undefined) {
    issue = storeQty_(p.issueQty, 'Issue now');
    order = storeQty_(p.orderQty, 'Order');
  } else {
    // the old two-button shape
    var action = safeStr_(p.action).toUpperCase();
    if (action === 'ISSUE') {
      issue = storeQty_(p.issuedQty !== undefined && safeStr_(p.issuedQty) !== ''
                        ? p.issuedQty : asked, 'Issue now');
      order = 0;
    } else if (action === 'FORWARD') {
      issue = 0;
      order = storeQty_(p.adjustedQty !== undefined && safeStr_(p.adjustedQty) !== ''
                        ? p.adjustedQty : asked, 'Order');
    } else {
      throw new Error('Enter how much to issue now and how much to order.');
    }
  }

  // S3 — something has to happen
  if (issue === 0 && order === 0) {
    throw new Error('Nothing would happen. Enter a quantity to issue, a quantity to order, ' +
                    'or both. To order without issuing anything, leave "Issue now" at 0.');
  }

  if (issue > 0) {
    var shelf = shelfFor_(ind.Site, ind.Part_Name, ind.Part_Number);
    // S4 — an item with no row has no figure to issue against
    if (!shelf.listed) {
      throw new Error('"' + safeStr_(ind.Part_Name) + '" is not on the ' + ind.Site +
                      ' stock list, so there is no figure to issue against. Add it under ' +
                      'Stock first, or send the whole quantity to purchase.');
    }
    // S1 — never issue more than the shelf holds
    if (issue > shelf.stock) {
      throw new Error('Only ' + shelf.stock + ' ' + shelf.unit + ' of "' + shelf.name +
                      '" ' + (shelf.stock === 1 ? 'is' : 'are') + ' on the shelf at ' + ind.Site +
                      '. You cannot issue ' + issue + '. Issue up to ' + shelf.stock +
                      ' and order the rest.');
    }
  }
  return { issue: issue, order: order };
}

/** S2 — a quantity is a real, finite, non-negative number or it is nothing. */
function storeQty_(v, label) {
  if (v === undefined || v === null || safeStr_(v) === '') return 0;
  var n = Number(v);
  if (isNaN(n) || !isFinite(n)) throw new Error(label + ' must be a number.');
  if (n < 0) throw new Error(label + ' cannot be negative.');
  return n;
}

/* ================================================================== */
/*  STAGE 3 — Purchase mode / quotations                               */
/* ================================================================== */

function purchaseSubmit_(token, p) {
  var actor = requireStageRole_(token, 'PURCHASE_MODE');
  return withLock_(function () {
    var ind = getIndentOrThrow_(p.indentId);
    assertStage_(ind, 'PURCHASE_MODE');

    var mode = safeStr_(p.mode).toUpperCase();       // DIRECT | COMPETITIVE
    var maxQ = num_(getSetting_('MAX_QUOTES'), 5);
    var quotes = [];

    if (mode === 'DIRECT') {
      var vName = resolveVendor_(p.vendorId, p.vendorName, actor);
      var amt   = num_(p.amount, 0);
      if (!vName) throw new Error('Vendor is required for a direct purchase.');
      /* Direct purchase is the purchase team spending on their own authority.
         Above the item's ceiling that authority does not exist, so the route
         is closed rather than quietly turned into an approval — otherwise
         "direct" would mean two different things depending on the quantity. */
      var ceiling = overMaxOrderQty_(ind);
      if (ceiling) {
        throw new Error(ind.Quantity + ' ' + safeStr_(ind.Unit) + ' is over the maximum order ' +
          'quantity of ' + ceiling + ' set for "' + safeStr_(ind.Part_Name) + '" at ' + ind.Site +
          ', so it cannot be bought direct. Raise quotations instead and let the ' +
          'administrator approve it.');
      }
      quotes.push({
        Vendor_Name: vName, Brand: safeStr_(p.brand),
        Price_Per_Unit: num_(p.pricePerUnit, amt), Quantity: ind.Quantity,
        Total_Amount: amt, Delivery_Days: safeStr_(p.deliveryDays), Remarks: safeStr_(p.remarks)
      });
    } else if (mode === 'COMPETITIVE') {
      var list = p.quotes || [];
      if (!list.length) throw new Error('Add at least one vendor quotation.');
      if (list.length > maxQ) throw new Error('At most ' + maxQ + ' quotations are allowed.');
      for (var i = 0; i < list.length; i++) {
        var q = list[i];
        var vn = resolveVendor_(q.vendorId, q.vendorName, actor);
        if (!vn) throw new Error('Quotation ' + (i + 1) + ' has no vendor.');
        if (num_(q.totalAmount, 0) <= 0) throw new Error('Quotation ' + (i + 1) + ' needs a total amount.');
        quotes.push({
          Vendor_Name: vn, Brand: safeStr_(q.brand),
          Price_Per_Unit: num_(q.pricePerUnit, 0), Quantity: safeStr_(q.quantity) || ind.Quantity,
          Total_Amount: num_(q.totalAmount, 0), Delivery_Days: safeStr_(q.deliveryDays),
          Remarks: safeStr_(q.remarks)
        });
      }
    } else {
      throw new Error('Purchase mode must be DIRECT or COMPETITIVE.');
    }

    // Any earlier quotes for this indent are superseded.
    readWhere_(SH.QUOTES, function (q) {
      return String(q.Indent_ID) === String(ind.Indent_ID) && String(q.Status) === 'PENDING';
    }).forEach(function (q) { update_(SH.QUOTES, q.__row, { Status: 'SUPERSEDED' }); });

    var t = now_();
    var toInsert = quotes.map(function (q, i) {
      var v = findBy_(SH.VENDORS, 'Vendor_Name', q.Vendor_Name);
      return {
        Quotation_ID: ind.Indent_ID + '-Q' + (i + 1) + '-' + uuid_().slice(0, 4),
        Indent_ID: ind.Indent_ID, Vendor_ID: v ? v.Vendor_ID : '', Vendor_Name: q.Vendor_Name,
        Brand: q.Brand, Price_Per_Unit: q.Price_Per_Unit, Quantity: q.Quantity,
        Total_Amount: q.Total_Amount, Delivery_Days: q.Delivery_Days, Remarks: q.Remarks,
        Status: 'PENDING', Created_By: actor.Name, Created_At: t, Decided_By: '', Decided_At: ''
      };
    });
    insertMany_(SH.QUOTES, toInsert);

    /* A direct purchase is the purchase team using their own authority: it goes
       straight to logistics. Two things pull it back to the admin — the rupee
       ceiling, and the item's own maximum order quantity. The quantity rule
       matters because one large order must not slip through as a cheap one. */
    var limit = num_(getSetting_('DIRECT_PURCHASE_LIMIT'), 0);
    var amount = num_(toInsert[0].Total_Amount, 0);
    var overLimit = (mode === 'DIRECT' && limit > 0 && amount > limit);
    var overMax   = 0;          // a direct purchase over the ceiling never gets this far
    var skipApproval = (mode === 'DIRECT' && !overLimit);

    if (skipApproval) {
      var t2 = now_();
      update_(SH.QUOTES, toInsert[0].__row, {
        Status: 'APPROVED', Decided_By: actor.Name + ' (own authority)', Decided_At: t2
      });
      skipStages_(ind.Indent_ID, ['ADMIN_APPROVAL'],
        'Direct purchase — no admin approval required');
      advance_(ind, 'PURCHASE_MODE', 'SET_ETA', actor, STATUS.APPROVED, {
        Purchase_Mode: mode, Purchaser: actor.Name,
        Final_Vendor: toInsert[0].Vendor_Name, Final_Amount: toInsert[0].Total_Amount,
        Approved_By: actor.Name + ' (direct purchase)', Approved_At: t2,
        Approval_Route: APPROVAL_ROUTE.DIRECT
      }, safeStr_(p.remarks));

      logHistory_(ind.Indent_ID, 'PURCHASE_MODE',
        'Direct purchase from ' + toInsert[0].Vendor_Name + ' — no approval required',
        'PURCHASE', actor, ind.Status, STATUS.APPROVED,
        { mode: mode, vendor: toInsert[0].Vendor_Name, amount: amount,
          approvalRoute: APPROVAL_ROUTE.DIRECT }, safeStr_(p.remarks));

      var indA = findBy_(SH.INDENTS, 'Indent_ID', ind.Indent_ID);
      notify_('BOUGHT_NO_APPROVAL', indA, { actorId: actor.User_ID,
        note: actor.Name + ' bought direct from ' + toInsert[0].Vendor_Name + ' for ' + amount });

      return { status: STATUS.APPROVED, quotations: 1, nextStage: 'SET_ETA',
               approvalRoute: APPROVAL_ROUTE.DIRECT, needsApproval: false };
    }

    advance_(ind, 'PURCHASE_MODE', 'ADMIN_APPROVAL', actor, STATUS.PENDING_APPROVAL, {
      Purchase_Mode: mode, Purchaser: actor.Name, Approval_Route: APPROVAL_ROUTE.ADMIN
    }, safeStr_(p.remarks));

    logHistory_(ind.Indent_ID, 'PURCHASE_MODE', mode !== 'DIRECT'
      ? 'Competitive quotations submitted'
      : (overMax
          ? ('Direct purchase submitted — ' + ind.Quantity + ' is over the maximum order quantity of ' +
             overMax + ' for this item, so it needs approval')
          : ('Direct purchase submitted — above the ' + limit + ' ceiling, so it needs approval')),
      'PURCHASE', actor, ind.Status, STATUS.PENDING_APPROVAL,
      { mode: mode, quotes: toInsert.length, overLimit: overLimit, overMaxOrderQty: overMax },
      safeStr_(p.remarks));

    notify_('NEEDS_APPROVAL', findBy_(SH.INDENTS, 'Indent_ID', ind.Indent_ID), {
      actorId: actor.User_ID,
      note: overMax
        ? ('Direct purchase from ' + toInsert[0].Vendor_Name + ' — ' + ind.Quantity +
           ' is over the maximum order quantity of ' + overMax + ' for this item')
        : (overLimit
            ? ('Direct purchase from ' + toInsert[0].Vendor_Name + ' for ' + amount +
               ' — above the ' + limit + ' limit, so it needs your approval')
            : (toInsert.length + ' quotations to compare'))
    });

    return { status: STATUS.PENDING_APPROVAL, quotations: toInsert.length,
             nextStage: 'ADMIN_APPROVAL', needsApproval: true,
             overLimit: overLimit, overMaxOrderQty: overMax };
  });
}

/** Find a vendor by id or name; create it on the fly if it is new. */
function resolveVendor_(vendorId, vendorName, actor) {
  if (safeStr_(vendorId)) {
    var v = findBy_(SH.VENDORS, 'Vendor_ID', safeStr_(vendorId));
    if (v) return v.Vendor_Name;
  }
  var name = safeStr_(vendorName);
  if (!name) return '';
  var byName = null;
  readAll_(SH.VENDORS).forEach(function (v) {
    if (!byName && String(v.Vendor_Name).toUpperCase() === name.toUpperCase()) byName = v;
  });
  if (byName) return byName.Vendor_Name;
  var id = nextId_(SH.VENDORS, 'Vendor_ID', 'VEN', 3);
  insert_(SH.VENDORS, {
    Vendor_ID: id, Vendor_Name: name, Contact_Person: '', Phone: '', Email: '',
    Category: 'GENERAL', Active: 'TRUE',
    Created_By: actor ? actor.Name : 'SYSTEM', Created_At: now_()
  });
  return name;
}

/* ================================================================== */
/*  STAGE 3b — "Direct from shop"                                      */
/*                                                                     */
/*  The purchaser walked into a shop, paid, and is holding the goods.  */
/*  Approval, ETA, dispatch chasing and the inbound check are all moot,*/
/*  so the indent lands straight on "Send to station". Both photos are */
/*  compulsory — they are the only record that this ever happened.     */
/* ================================================================== */

function shopPurchase_(token, p) {
  var actor = requireStageRole_(token, 'PURCHASE_MODE');
  return withLock_(function () {
    var ind = getIndentOrThrow_(p.indentId);
    assertStage_(ind, 'PURCHASE_MODE');

    var shop = resolveVendor_(p.vendorId, p.vendorName || p.shopName, actor);
    if (!shop) throw new Error('Enter the shop or vendor name.');
    var amount = num_(p.amount, 0);
    if (amount <= 0) throw new Error('Enter what you actually paid.');

    /* The shop had four when the indent asked for ten — that happens, and it
       is recorded honestly. The other direction never is: buying MORE than
       was asked for is somebody deciding to stock up with cash in a shop,
       outside every ceiling and approval the indent passed through. */
    var asked = num_(ind.Quantity, 0);
    var qty   = safeStr_(p.quantity) === '' || p.quantity === undefined
                  ? ind.Quantity : safeStr_(p.quantity);
    var qtyN  = Number(qty);
    if (isNaN(qtyN) || !isFinite(qtyN)) throw new Error('Quantity must be a number.');
    if (qtyN <= 0) throw new Error('Quantity must be more than zero.');
    if (qtyN > asked) {
      throw new Error('The indent is for ' + asked + ' ' + safeStr_(ind.Unit) + '. You can buy ' +
                      'less than that over a counter and the rest stays on order, but you ' +
                      'cannot buy more than was asked for.');
    }

    if (!p.billPhoto || !p.billPhoto.data) {
      throw new Error('Attach a photo of the bill — it is the only proof of this purchase.');
    }
    if (!p.materialPhoto || !p.materialPhoto.data) {
      throw new Error('Attach a photo of the goods you bought.');
    }

    /* Over the item's maximum order quantity, buying it over a counter is not
       an option at all — that is exactly the case the ceiling exists to catch. */
    /* The ceiling is always tested against the whole indent, never against
       the slice being bought today. Otherwise a 200-unit indent with a
       ceiling of 50 could be walked through the shop four times over. */
    var overMax = overMaxOrderQty_(ind);
    if (overMax) {
      throw new Error('This indent is for ' + asked + ' ' + safeStr_(ind.Unit) + ', which is over ' +
                      'the maximum order quantity of ' + overMax + ' set for "' + ind.Part_Name +
                      '" at ' + ind.Site + '. It cannot be bought over a counter at all — not ' +
                      'even part of it. Raise quotations and let the administrator approve it.');
    }

    var limit = num_(getSetting_('DIRECT_PURCHASE_LIMIT'), 0);
    if (limit > 0 && amount > limit) {
      throw new Error('That is above the ' + limit + ' limit the purchase team may spend without ' +
                      'approval. Raise it as a normal direct purchase so the admin can approve it.');
    }

    var t = now_();
    // supersede anything already quoted, then record what was actually bought
    readWhere_(SH.QUOTES, function (q) {
      return String(q.Indent_ID) === String(ind.Indent_ID) && String(q.Status) === 'PENDING';
    }).forEach(function (q) { update_(SH.QUOTES, q.__row, { Status: 'SUPERSEDED' }); });

    var v = findBy_(SH.VENDORS, 'Vendor_Name', shop);
    insert_(SH.QUOTES, {
      Quotation_ID: ind.Indent_ID + '-SHOP-' + uuid_().slice(0, 4),
      Indent_ID: ind.Indent_ID, Vendor_ID: v ? v.Vendor_ID : '', Vendor_Name: shop,
      Brand: safeStr_(p.brand), Price_Per_Unit: num_(p.pricePerUnit, ''), Quantity: qty,
      Total_Amount: amount, Delivery_Days: '0', Remarks: 'Bought over the counter',
      Status: 'APPROVED', Created_By: actor.Name, Created_At: t,
      Decided_By: actor.Name + ' (own authority)', Decided_At: t
    });

    var bill = attachPhoto_(ind.Indent_ID, 'PURCHASE_MODE', 'BILL',     p.billPhoto,     actor);
    var mat  = attachPhoto_(ind.Indent_ID, 'PURCHASE_MODE', 'MATERIAL', p.materialPhoto, actor);

    /* A checkpoint, not a movement. The purchaser is holding the goods; they
       reach the shelf when the plant checks them in, and booking them here as
       well would count the same items twice. */
    logStock_(ind.Site, ind.Indent_ID, ind.Part_Name, ind.Part_Number, qty,
              STOCK_TXN.PURCHASED_AT_SHOP, '', actor,
              'Counter purchase at ' + shop +
              (safeStr_(p.billNo) ? ', bill ' + safeStr_(p.billNo) : ''), false);

    skipStages_(ind.Indent_ID, STAGE_SET.SHOP_SKIP,
      'Bought over the counter — the purchaser had the goods in hand');

    advance_(ind, 'PURCHASE_MODE', 'SEND_TO_STATION', actor, STATUS.BOUGHT_AT_SHOP, {
      Purchase_Mode: 'SHOP', Purchaser: actor.Name,
      Final_Vendor: shop, Final_Amount: amount,
      Approved_By: actor.Name + ' (counter purchase)', Approved_At: t,
      Approval_Route: APPROVAL_ROUTE.SHOP,
      Shop_Name: shop, Shop_Bill_No: safeStr_(p.billNo), Shop_Purchase_At: t,
      Bill_Photo_URL: bill, Material_Photo_URL: mat,
      Destination_Type: 'FROM_SHOP',
      Primary_Location: safeStr_(p.primaryLocation) || ind.Site,
      Quantity: qty
    }, safeStr_(p.remarks));

    logHistory_(ind.Indent_ID, 'PURCHASE_MODE',
      'Bought over the counter at ' + shop + ' for ' + amount, 'PURCHASE', actor,
      ind.Status, STATUS.BOUGHT_AT_SHOP,
      { shop: shop, amount: amount, qty: qty, billNo: safeStr_(p.billNo),
        approvalRoute: APPROVAL_ROUTE.SHOP, photos: 2 }, safeStr_(p.remarks));

    var indS = findBy_(SH.INDENTS, 'Indent_ID', ind.Indent_ID);
    notify_('BOUGHT_AT_SHOP', indS, { actorId: actor.User_ID,
      note: qty + ' bought at ' + shop + ' for ' + amount + ' — bill and goods photographed' });
    notify_('BOUGHT_NO_APPROVAL', indS, { actorId: actor.User_ID,
      note: actor.Name + ' bought ' + qty + ' over the counter at ' + shop + ' for ' + amount });

    /* Bought fewer than the indent asked for. The part that was bought must
       keep moving — the goods are in the purchaser's hands and the requester
       is waiting — so it is not held up while the shortfall is chased. The
       shortfall becomes an indent of its own, linked to this one, and opens
       at purchase because the store already released it. Two indents, each
       with one honest quantity, rather than one indent with two. */
    var split = null;
    if (qtyN < asked) {
      split = splitRemainder_(ind, asked - qtyN, actor,
        qtyN + ' of ' + asked + ' bought over the counter at ' + shop +
        '; this is the ' + (asked - qtyN) + ' still to come');
    }

    return { status: STATUS.BOUGHT_AT_SHOP, nextStage: 'SEND_TO_STATION',
             shop: shop, billPhoto: bill, materialPhoto: mat,
             boughtQty: qtyN, askedQty: asked,
             remainingQty: split ? (asked - qtyN) : 0,
             remainderIndentId: split ? split.indentId : '' };
  });
}

/* ==================================================================
   A partly-bought indent, split into two
   ------------------------------------------------------------------
   The shop had eight of the twenty. Recording "20 bought" would be a lie
   the ledger would carry forever; recording "8" and closing the indent
   would quietly drop twelve the plant still needs. So the eight travel on
   under the original number, and the twelve become a new indent that
   points back at it.

   The new one opens at PURCHASE_MODE, not at the store: the store has
   already looked at this exact item, at this site, and released it. Asking
   them again would be asking the same question twice.
   ================================================================== */
function splitRemainder_(parent, qty, actor, why) {
  var id = nextId_(SH.INDENTS, 'Indent_ID', 'IND', 4);
  var t  = now_();

  var child = {
    Indent_ID: id, Timestamp: t,
    Requester_ID: parent.Requester_ID, Requested_By: parent.Requested_By,
    Site: parent.Site, Section: safeStr_(parent.Section),
    Part_Number: safeStr_(parent.Part_Number), Part_Name: safeStr_(parent.Part_Name),
    Quantity: qty, Requested_Qty: qty, Requester_Received_Qty: '',
    Unit: safeStr_(parent.Unit),
    Description: safeStr_(parent.Description),
    Photo_URL: safeStr_(parent.Photo_URL),
    Priority: safeStr_(parent.Priority) || 'NORMAL',
    Current_Stage: 'PURCHASE_MODE', Status: STATUS.SENT_TO_PURCHASE,
    Store_Action: 'CARRIED_FROM_' + safeStr_(parent.Indent_ID),
    Issued_Qty: '', Store_Remarks: safeStr_(why),
    Purchase_Mode: '', Purchaser: '', Final_Vendor: '', Final_Amount: '',
    Approved_By: '', Approved_At: '',
    ETA: '', Destination_Type: '', Primary_Location: parent.Site,
    Secondary_Location: '', Transit_ETA: '', Dispatch_Status: '', Vehicle_Details: '',
    Received_Qty: '', QC_Result: '', QC_Remarks: '',
    Confirmed_By: '', Confirm_Remarks: '', Remarks: '',
    Created_At: t, Updated_At: t, Completed_At: '',
    Total_Cycle_Mins: '', Total_Delay_Mins: '',
    Parent_Indent_ID: safeStr_(parent.Indent_ID),
    Split_Reason: safeStr_(why),
    /* A remainder is the same indent, continued. Whoever raised the parent
       raised this, so it closes with the same question they would have been
       asked there. */
    Raised_By_Role: safeStr_(parent.Raised_By_Role)
  };
  insert_(SH.INDENTS, child);
  seedStageRows_(id);

  // steps 1 and 2 are already behind it — they were done on the parent
  openStage_(id, 'INDENT_RAISED', t);
  closeStage_(id, 'INDENT_RAISED', t, actor, 'Carried over from ' + parent.Indent_ID);
  skipStages_(id, ['STORE_VERIFY'],
    'Already verified on ' + parent.Indent_ID + ' — this is the part that is still to come');

  var s2 = openStage_(id, 'PURCHASE_MODE', t);
  update_(SH.INDENTS, child.__row, {
    Stage_Entered_At: s2.entered, Stage_Planned_At: s2.planned
  });

  logHistory_(id, 'PURCHASE_MODE',
    'Carried over from ' + parent.Indent_ID + ' — ' + qty + ' ' + safeStr_(parent.Unit) +
    ' still to be bought', 'PURCHASE', actor, '', STATUS.SENT_TO_PURCHASE,
    { parent: safeStr_(parent.Indent_ID), qty: qty, reason: safeStr_(why) }, safeStr_(why));

  // and the parent says where the rest went, so neither half is a loose end
  logHistory_(parent.Indent_ID, 'PURCHASE_MODE',
    'The remaining ' + qty + ' ' + safeStr_(parent.Unit) + ' carried over to ' + id,
    'PURCHASE', actor, '', '',
    { remainder: id, qty: qty }, safeStr_(why));

  notify_('SENT_TO_PURCHASE', findBy_(SH.INDENTS, 'Indent_ID', id), {
    actorId: actor.User_ID,
    note: id + ' is the ' + qty + ' ' + safeStr_(parent.Unit) + ' of "' +
          safeStr_(parent.Part_Name) + '" still owed from ' + parent.Indent_ID + '.'
  });

  return { indentId: id, qty: qty, parent: safeStr_(parent.Indent_ID) };
}

/* ================================================================== */
/*  STAGE 4 — Admin approval                                           */
/* ================================================================== */

function adminDecision_(token, p) {
  var actor = requireStageRole_(token, 'ADMIN_APPROVAL');
  return withLock_(function () {
    var ind = getIndentOrThrow_(p.indentId);
    assertStage_(ind, 'ADMIN_APPROVAL');
    var decision = safeStr_(p.decision).toUpperCase();  // APPROVE | REJECT | SEND_BACK
    var remarks  = safeStr_(p.remarks);
    var t = now_();

    if (decision === 'APPROVE') {
      var qid = safeStr_(p.quotationId);
      var all = readWhere_(SH.QUOTES, function (q) {
        return String(q.Indent_ID) === String(ind.Indent_ID) && String(q.Status) === 'PENDING';
      });
      if (!all.length) throw new Error('There are no pending quotations to approve.');
      var win = null;
      all.forEach(function (q) { if (String(q.Quotation_ID) === qid) win = q; });
      if (!win) {
        if (all.length === 1) win = all[0];
        else throw new Error('Select which quotation you are approving.');
      }
      all.forEach(function (q) {
        update_(SH.QUOTES, q.__row, {
          Status: (String(q.Quotation_ID) === String(win.Quotation_ID)) ? 'APPROVED' : 'REJECTED',
          Decided_By: actor.Name, Decided_At: t
        });
      });
      advance_(ind, 'ADMIN_APPROVAL', 'SET_ETA', actor, STATUS.APPROVED, {
        Final_Vendor: win.Vendor_Name, Final_Amount: win.Total_Amount,
        Approved_By: actor.Name, Approved_At: t
      }, remarks);
      logHistory_(ind.Indent_ID, 'ADMIN_APPROVAL', 'Quotation approved', 'APPROVAL', actor,
        ind.Status, STATUS.APPROVED,
        { vendor: win.Vendor_Name, amount: win.Total_Amount, rejected: all.length - 1 }, remarks);
      notify_('APPROVED', findBy_(SH.INDENTS, 'Indent_ID', ind.Indent_ID), {
        actorId: actor.User_ID,
        note: 'Approved: ' + win.Vendor_Name + ' — ' + win.Total_Amount + (remarks ? ' · ' + remarks : '')
      });
      return { status: STATUS.APPROVED, vendor: win.Vendor_Name, nextStage: 'SET_ETA' };
    }

    if (decision === 'SEND_BACK') {
      readWhere_(SH.QUOTES, function (q) {
        return String(q.Indent_ID) === String(ind.Indent_ID) && String(q.Status) === 'PENDING';
      }).forEach(function (q) {
        update_(SH.QUOTES, q.__row, { Status: 'SENT_BACK', Decided_By: actor.Name, Decided_At: t });
      });
      advance_(ind, 'ADMIN_APPROVAL', 'PURCHASE_MODE', actor, STATUS.SENT_TO_PURCHASE, {}, remarks);
      logHistory_(ind.Indent_ID, 'ADMIN_APPROVAL', 'Sent back to purchase', 'APPROVAL', actor,
        ind.Status, STATUS.SENT_TO_PURCHASE, {}, remarks);
      notify_('SENT_BACK', findBy_(SH.INDENTS, 'Indent_ID', ind.Indent_ID),
        { actorId: actor.User_ID, note: remarks });
      return { status: STATUS.SENT_TO_PURCHASE, nextStage: 'PURCHASE_MODE' };
    }

    if (decision === 'REJECT') {
      readWhere_(SH.QUOTES, function (q) {
        return String(q.Indent_ID) === String(ind.Indent_ID) && String(q.Status) === 'PENDING';
      }).forEach(function (q) {
        update_(SH.QUOTES, q.__row, { Status: 'REJECTED', Decided_By: actor.Name, Decided_At: t });
      });
      skipStages_(ind.Indent_ID, STAGE_SET.AFTER_APPROVAL, 'Indent rejected by admin');
      advance_(ind, 'ADMIN_APPROVAL', null, actor, STATUS.REJECTED, { Remarks: remarks }, remarks);
      logHistory_(ind.Indent_ID, 'ADMIN_APPROVAL', 'Indent rejected', 'APPROVAL', actor,
        ind.Status, STATUS.REJECTED, {}, remarks);
      notify_('REJECTED', findBy_(SH.INDENTS, 'Indent_ID', ind.Indent_ID),
        { actorId: actor.User_ID, note: remarks });
      return { status: STATUS.REJECTED, nextStage: null };
    }

    throw new Error('Decision must be APPROVE, REJECT or SEND_BACK.');
  });
}

/* ================================================================== */
/*  STAGE 5 — ETA & logistics                                          */
/* ================================================================== */

function setEta_(token, p) {
  var actor = requireStageRole_(token, 'SET_ETA');
  return withLock_(function () {
    var ind = getIndentOrThrow_(p.indentId);
    assertStage_(ind, 'SET_ETA');

    var eta = toDate_(p.eta);
    if (!eta) throw new Error('A valid estimated arrival date & time is required.');

    var destType = safeStr_(p.destinationType).toUpperCase() || 'DIRECT_TO_PLANT';
    if (['DIRECT_TO_PLANT','VIA_HUB'].indexOf(destType) === -1) {
      throw new Error('Destination type must be DIRECT_TO_PLANT or VIA_HUB.');
    }
    var secondary = safeStr_(p.secondaryLocation);
    var transit   = toDate_(p.transitEta);
    if (destType === 'VIA_HUB' && !secondary) {
      throw new Error('An intermediate hub name is required when shipping via a hub.');
    }

    // Straight to the plant means there is no hub leg at all: no "send to
    // station", and only one receipt check (done at the plant itself).
    if (destType === 'DIRECT_TO_PLANT') {
      skipStages_(ind.Indent_ID, STAGE_SET.HUB_LEG, 'Shipped direct to plant — no hub leg');
    } else {
      unskipStages_(ind.Indent_ID, STAGE_SET.HUB_LEG);
    }

    /* Whatever the logistics step has in hand — the transport docket, the
       lorry number plate, the packing list. They go on the indent's own
       attachment register rather than into a column, because there may be
       none and there may be several, and a column can hold neither. */
    var shots = attachPhotos_(ind.Indent_ID, 'SET_ETA', 'ETA',
                              p.photos || (p.photo ? [p.photo] : []), actor);

    advance_(ind, 'SET_ETA', 'FOLLOW_UP', actor, STATUS.ETA_SET, {
      ETA: eta, Destination_Type: destType,
      Primary_Location: safeStr_(p.primaryLocation) || ind.Site,
      Secondary_Location: secondary, Transit_ETA: transit || ''
    }, safeStr_(p.remarks));

    logHistory_(ind.Indent_ID, 'SET_ETA',
      (destType === 'VIA_HUB' ? ('ETA set — routed via ' + secondary) : 'ETA set — direct to plant') +
      (shots.length ? (' — ' + shots.length + (shots.length === 1 ? ' photo' : ' photos') + ' attached') : ''),
      'PURCHASE', actor, ind.Status, STATUS.ETA_SET,
      { eta: iso_(eta), destination: destType, hub: secondary,
        hubLeg: destType === 'VIA_HUB', photos: shots.length }, safeStr_(p.remarks));

    notify_('ETA_SET', findBy_(SH.INDENTS, 'Indent_ID', ind.Indent_ID), {
      actorId: actor.User_ID,
      note: 'Expected ' + fmt_(eta) + (destType === 'VIA_HUB' ? ' via ' + secondary : ' direct to plant')
    });

    return { status: STATUS.ETA_SET, nextStage: 'FOLLOW_UP', hubLeg: destType === 'VIA_HUB',
             photos: shots };
  });
}

/* ================================================================== */
/*  STAGE 6 — Dispatch follow-up                                       */
/* ================================================================== */

function dispatchUpdate_(token, p) {
  // chasing a dispatch is shared between purchase and the coordinator (by default)
  var actor = requireStageRole_(token, 'FOLLOW_UP');
  return withLock_(function () {
    var ind = getIndentOrThrow_(p.indentId);
    assertStage_(ind, 'FOLLOW_UP');
    var ds = safeStr_(p.dispatchStatus) || 'Dispatched';
    var bill = attachPhoto_(ind.Indent_ID, 'FOLLOW_UP', 'BILL',     p.billPhoto,     actor);
    var mat  = attachPhoto_(ind.Indent_ID, 'FOLLOW_UP', 'MATERIAL', p.materialPhoto, actor);
    advance_(ind, 'FOLLOW_UP', 'RECEIVE_CHECK', actor, STATUS.IN_TRANSIT, {
      Dispatch_Status: ds, Bill_Photo_URL: bill, Material_Photo_URL: mat
    }, safeStr_(p.remarks));
    logHistory_(ind.Indent_ID, 'FOLLOW_UP', 'Dispatch confirmed: ' + ds, 'PURCHASE', actor,
      ind.Status, STATUS.IN_TRANSIT,
      { dispatchStatus: ds, billPhoto: bill ? 1 : 0, materialPhoto: mat ? 1 : 0 }, safeStr_(p.remarks));
    notify_('DISPATCHED', findBy_(SH.INDENTS, 'Indent_ID', ind.Indent_ID), {
      actorId: actor.User_ID,
      note: ds + (bill || mat ? ' · photos attached' : '') + (safeStr_(p.remarks) ? ' · ' + safeStr_(p.remarks) : '')
    });

    return { status: STATUS.IN_TRANSIT, nextStage: 'RECEIVE_CHECK',
             billPhoto: bill, materialPhoto: mat };
  });
}

/* ================================================================== */
/*  STAGE 7 — Receive & Check  (quantity AND quality, in one go)        */
/*                                                                      */
/*  Direct to plant : this is the only check, and it happens AT the      */
/*                    plant. The indent then goes straight to the        */
/*                    requester for confirmation.                        */
/*  Via a hub       : this is the FIRST check, and it happens AT the     */
/*                    hub. The hub that received it first is recorded    */
/*                    on the indent, in the stock ledger and in the      */
/*                    history. Stage 9 checks it again at the plant.     */
/* ================================================================== */

function receiveCheck_(token, p) {
  var actor = requireStageRole_(token, 'RECEIVE_CHECK');
  return withLock_(function () {
    var ind = getIndentOrThrow_(p.indentId);
    assertStage_(ind, 'RECEIVE_CHECK');
    assertSameSite_(actor, ind);

    var viaHub = String(ind.Destination_Type) === 'VIA_HUB';
    var check  = validateCheck_(p, ind.Quantity);
    var where  = safeStr_(p.location) ||
                 (viaHub ? safeStr_(ind.Secondary_Location) : safeStr_(ind.Primary_Location) || ind.Site);
    var t = now_();

    /* Via a hub this is only the first of two counts and the goods are not
       on site yet, so the ledger records the movement but the stock figure
       does not move. Straight to the plant, this IS the arrival, so it does. */
    var note = ('Received at ' + where + '. ' + check.remarks).trim() +
               (check.grade !== 'PERFECT' ? ' [' + check.grade + ']' : '');
    if (viaHub) {
      logStock_(ind.Site, ind.Indent_ID, ind.Part_Name, ind.Part_Number, check.qty,
                STOCK_TXN.RECEIVED_AT_HUB, '', actor, note, false);
    } else {
      adjustStock_(ind.Site, ind.Indent_ID, ind.Part_Name, ind.Part_Number,
                   num_(check.qty, 0), STOCK_TXN.RECEIVED_AT_PLANT, actor, note);
    }

    var shot = attachPhoto_(ind.Indent_ID, 'RECEIVE_CHECK',
                            viaHub ? 'RECEIPT_HUB' : 'RECEIPT_PLANT', p.photo, actor);
    var patch = {
      First_Receipt_Location: where, First_Received_Qty: check.qty,
      First_QC_Result: check.grade, First_QC_Remarks: check.remarks, First_Received_At: t,
      First_Receipt_Photo_URL: shot
    };
    var next, status, label;

    if (viaHub) {
      next   = 'SEND_TO_STATION';
      status = STATUS.RECEIVED_AT_HUB;
      label  = 'Received & checked at hub: ' + where;
    } else {
      // no hub leg — this receipt is also the final one
      next   = 'CONFIRM_REQUEST';
      status = STATUS.RECEIVED_AT_PLANT;
      label  = 'Received & checked at plant: ' + where;
      patch.Received_Qty = check.qty;
      patch.QC_Result    = check.grade;
      patch.QC_Remarks   = check.remarks;
      patch.Final_Receipt_Location  = where;
      patch.Plant_Receipt_Photo_URL = shot;
    }

    advance_(ind, 'RECEIVE_CHECK', next, actor, status, patch, label);
    logHistory_(ind.Indent_ID, 'RECEIVE_CHECK', label + ' — ' + check.grade, 'STORE', actor,
      ind.Status, status,
      { location: where, receivedQty: check.qty, quality: check.grade, viaHub: viaHub,
        photo: shot ? 1 : 0 }, check.remarks);

    notify_(viaHub ? 'RECEIVED_AT_HUB' : 'READY_TO_CONFIRM',
      findBy_(SH.INDENTS, 'Indent_ID', ind.Indent_ID),
      { actorId: actor.User_ID, note: label + ' · ' + check.qty + ' · ' + check.grade });

    return { status: status, nextStage: next, location: where, quality: check.grade,
             viaHub: viaHub, photo: shot };
  });
}

/** Shared quantity+quality validation for both receipt checks. */
function validateCheck_(p, defaultQty) {
  var grade = safeStr_(p.qcResult).toUpperCase();
  if (!grade) throw new Error('Record the quality along with the quantity (Perfect, Partial or Defective).');
  if (QC_GRADES.indexOf(grade) === -1) {
    throw new Error('Quality must be ' + QC_GRADES.join(', ') + '.');
  }
  var raw = safeStr_(p.receivedQty) || safeStr_(defaultQty);
  if (!raw) throw new Error('Record how many were received.');

  /* This figure goes straight onto the shelf, so it has to be a real
     number. "lots" used to sail through and land in the ledger. */
  var qty = Number(raw);
  if (isNaN(qty) || !isFinite(qty)) throw new Error('The quantity received must be a number.');
  if (qty < 0) throw new Error('The quantity received cannot be negative.');

  var remarks = safeStr_(p.remarks);
  if (grade !== 'PERFECT' && !remarks) {
    throw new Error('Please describe the problem in the remarks.');
  }

  /* More than was ordered is possible — a vendor over-supplies — but it must
     be deliberate, because it is about to inflate the shelf. */
  var ordered = num_(defaultQty, 0);
  if (ordered > 0 && qty > ordered && !remarks) {
    throw new Error('You have entered ' + qty + ' against an order of ' + ordered +
                    '. If more really did arrive, say so in the remarks so the extra ' +
                    'stock is accounted for.');
  }
  return { grade: grade, qty: qty, remarks: remarks };
}

/* ================================================================== */
/*  STAGE 8 — Send To Station   (hub route only)                       */
/* ================================================================== */

function sendToStation_(token, p) {
  var actor = requireStageRole_(token, 'SEND_TO_STATION');
  return withLock_(function () {
    var ind = getIndentOrThrow_(p.indentId);
    assertStage_(ind, 'SEND_TO_STATION');
    assertSameSite_(actor, ind);
    var dt = String(ind.Destination_Type);
    if (dt !== 'VIA_HUB' && dt !== 'FROM_SHOP') {
      throw new Error('This consignment went straight to the plant, so there is no station leg.');
    }
    var veh = safeStr_(p.vehicleDetails);
    if (!veh) throw new Error('Vehicle / dispatch details are required.');
    advance_(ind, 'SEND_TO_STATION', 'PLANT_RECEIVE', actor, STATUS.IN_TRANSIT_TO_PLANT, {
      Vehicle_Details: veh
    }, safeStr_(p.remarks));
    logHistory_(ind.Indent_ID, 'SEND_TO_STATION',
      'Sent from ' + (safeStr_(ind.First_Receipt_Location) || safeStr_(ind.Shop_Name) || 'purchase') +
      ' to ' + safeStr_(ind.Primary_Location || ind.Site),
      'STORE', actor, ind.Status, STATUS.IN_TRANSIT_TO_PLANT,
      { vehicle: veh, from: safeStr_(ind.First_Receipt_Location) }, safeStr_(p.remarks));
    notify_('AT_STATION', findBy_(SH.INDENTS, 'Indent_ID', ind.Indent_ID),
      { actorId: actor.User_ID, note: 'Vehicle ' + veh });
    return { status: STATUS.IN_TRANSIT_TO_PLANT, nextStage: 'PLANT_RECEIVE' };
  });
}

/* ================================================================== */
/*  STAGE 9 — Plant Receipt & Check   (hub route only, second check)   */
/* ================================================================== */

function plantReceive_(token, p) {
  var actor = requireStageRole_(token, 'PLANT_RECEIVE');
  return withLock_(function () {
    var ind = getIndentOrThrow_(p.indentId);
    assertStage_(ind, 'PLANT_RECEIVE');
    assertSameSite_(actor, ind);

    var check = validateCheck_(p, ind.First_Received_Qty || ind.Quantity);
    var where = safeStr_(p.location) || safeStr_(ind.Primary_Location) || ind.Site;

    // Goods are on site: the stock figure rises by what was actually counted.
    adjustStock_(ind.Site, ind.Indent_ID, ind.Part_Name, ind.Part_Number,
                 num_(check.qty, 0), STOCK_TXN.RECEIVED_AT_PLANT, actor,
                 ('Received at ' + where + '. ' + check.remarks).trim() +
                 (check.grade !== 'PERFECT' ? ' [' + check.grade + ']' : ''));

    var shortBy = '';
    if (safeStr_(ind.First_Received_Qty) &&
        String(ind.First_Received_Qty).trim() !== String(check.qty).trim()) {
      shortBy = 'Quantity differs from the hub check (' + ind.First_Received_Qty + ' at ' +
                safeStr_(ind.First_Receipt_Location) + ', ' + check.qty + ' at plant).';
    }

    var shot2 = attachPhoto_(ind.Indent_ID, 'PLANT_RECEIVE', 'RECEIPT_PLANT', p.photo, actor);

    advance_(ind, 'PLANT_RECEIVE', 'CONFIRM_REQUEST', actor, STATUS.RECEIVED_AT_PLANT, {
      Received_Qty: check.qty, QC_Result: check.grade,
      QC_Remarks: (check.remarks + (shortBy ? ' | ' + shortBy : '')).trim(),
      Final_Receipt_Location: where, Plant_Receipt_Photo_URL: shot2
    }, check.remarks);

    logHistory_(ind.Indent_ID, 'PLANT_RECEIVE',
      'Received & checked at plant: ' + where + ' — ' + check.grade, 'STORE', actor,
      ind.Status, STATUS.RECEIVED_AT_PLANT,
      { location: where, receivedQty: check.qty, quality: check.grade,
        firstCheckLocation: safeStr_(ind.First_Receipt_Location),
        firstCheckQty: safeStr_(ind.First_Received_Qty) },
      (check.remarks + (shortBy ? ' | ' + shortBy : '')).trim());

    notify_('READY_TO_CONFIRM', findBy_(SH.INDENTS, 'Indent_ID', ind.Indent_ID), {
      actorId: actor.User_ID,
      note: check.qty + ' received at ' + where + ' · ' + check.grade + (shortBy ? ' · ' + shortBy : '')
    });

    return { status: STATUS.RECEIVED_AT_PLANT, nextStage: 'CONFIRM_REQUEST',
             quality: check.grade, discrepancy: shortBy, photo: shot2 };
  });
}

/* ================================================================== */
/*  STAGE 10 — Confirm with the requester                              */
/* ================================================================== */

/* ------------------------------------------------------------------
   Closing the loop.

   The requester says how much they actually took away, and ONE rule
   settles the shelf whatever route the goods travelled:

       shelf change  =  −( taken − already issued )

   Every case falls out of it:

     issued 6, took 6   →  0    the shelf already lost 6 at step 2
     issued 6, took 4   →  +2   the two unwanted go back
     issued 0, took 15  →  −15  of a 30 delivery; 15 stay on the shelf
     issued 2, took 5   →  −3   2 came off the shelf, 3 off the delivery

   The old code had two separate settlements for these, which is exactly
   how IND-0014 handed back 45 boxes that had never left.
   ------------------------------------------------------------------ */
function confirmRequester_(token, p) {
  var actor = requireAuth_(token);
  return withLock_(function () {
    var ind = getIndentOrThrow_(p.indentId);
    assertStage_(ind, 'CONFIRM_REQUEST');
    var role = String(actor.Role).toUpperCase();
    if (role !== 'ADMIN' && String(ind.Requester_ID) !== String(actor.User_ID)) {
      throw new Error('Only ' + ind.Requested_By + ' (who raised this indent) or an admin can close it.');
    }
    /* Two different questions, because two different things happened.
       A fitter's indent ends with them walking off with the goods, so the
       question is how much they took. The store's own indent ends with the
       goods ON the shelf — restocking it was the whole point — so the
       question is whether any of it went straight back out again. */
    return raisedBySupply_(ind) ? closeSupplyIndent_(ind, actor, p)
                                : closeRequesterIndent_(ind, actor, p);
  });
}

/* ==================================================================
   Closing a shop-floor indent — "how much are you taking?"
   ================================================================== */
function closeRequesterIndent_(ind, actor, p) {
  var asked  = safeStr_(ind.Requested_Qty) || ind.Quantity;
  var issued = num_(ind.Issued_Qty, 0);
  var landed = availableToTake_(ind);            // issued + what actually arrived

  /* The app always asks. A caller that omits the field entirely (an old
     browser tab) falls back to what was asked for, and says so in the
     record — a guess that moves stock must never be silent. */
  var given   = p.receivedQty !== undefined && p.receivedQty !== null;
  var assumed = !given;
  var took;
  if (given) {
    if (safeStr_(p.receivedQty) === '') {
      throw new Error('Enter how much you actually took, so the store figure stays right.');
    }
    took = Number(p.receivedQty);
    if (isNaN(took) || !isFinite(took)) throw new Error('The quantity you took must be a number.');
    if (took < 0) throw new Error('The quantity you took cannot be negative.');
  } else {
    // an assumption never exceeds what actually arrived
    took = Math.min(num_(asked, 0), landed);
  }

  // C1 — you cannot take more than was ever made available to you
  if (took > landed) {
    throw new Error('You can take at most ' + landed + ' ' + safeStr_(ind.Unit) +
                    ' — that is everything issued and delivered against this indent.');
  }

  var remarks = safeStr_(p.remarks);
  var delta   = -(took - issued);                 // the one rule
  var note    = 'Requester took ' + took + ' ' + safeStr_(ind.Unit) +
                (issued ? ' (' + issued + ' issued at the store)' : '') +
                ' of ' + landed + ' available, against a request for ' + asked +
                (assumed ? ' — quantity assumed, not counted' : '');

  if (delta !== 0) {
    adjustStock_(ind.Site, ind.Indent_ID, ind.Part_Name, ind.Part_Number, delta,
                 delta < 0 ? STOCK_TXN.TAKEN_BY_REQUESTER : STOCK_TXN.RETURNED_TO_STOCK,
                 actor, note);
  }

  advance_(ind, 'CONFIRM_REQUEST', null, actor, STATUS.COMPLETED, {
    Confirmed_By: actor.Name, Confirm_Remarks: remarks,
    Requester_Received_Qty: took
  }, remarks);

  var kept = landed - took;
  logHistory_(ind.Indent_ID, 'CONFIRM_REQUEST', 'Receipt confirmed — indent closed', 'INDENT', actor,
    ind.Status, STATUS.COMPLETED,
    { requestedQty: asked, orderedQty: ind.Quantity, issuedQty: issued,
      availableQty: landed, takenQty: took, assumed: assumed, leftOnShelf: kept },
    (remarks ? remarks + ' | ' : '') + note);

  return { status: STATUS.COMPLETED, nextStage: null, assumed: assumed,
           takenQty: took, requestedQty: asked, orderedQty: ind.Quantity,
           issuedQty: issued, availableQty: landed, leftOnShelf: kept,
           stockNow: derivedStockNow_(ind) };
}

/* ==================================================================
   Closing a store's or purchase's own indent
   ------------------------------------------------------------------
   These are restocking orders. The goods came in and went onto the shelf
   at the receipt step, and the usual case is that they simply stay there
   — so the first question is a plain yes or no, and "no" closes the
   indent without moving anything.

   "Yes" is a real issue to a named person, and it is not bounded by what
   this indent ordered: a storekeeper restocking twenty may well hand out
   twenty-five, because five were already on the shelf. What it IS bounded
   by is the shelf itself. You cannot give away what is not there.
   ================================================================== */
function closeSupplyIndent_(ind, actor, p) {
  var unit   = safeStr_(ind.Unit);
  var issued = num_(ind.Issued_Qty, 0);        // anything handed over at step 2
  var shelf  = shelfFor_(ind.Site, ind.Part_Name, ind.Part_Number);
  var onHand = shelf.listed ? num_(shelf.stock, 0) : 0;

  /* The ceiling. Whatever was issued at step 2 has already left the shelf,
     so raising the figure to it costs nothing more; every unit above that
     comes off what is there now. */
  var ceiling = onHand + issued;

  var giving = truthy_(p.givingAway) ||
               ['YES', 'Y', 'TRUE', '1'].indexOf(String(p.givingAway || '').toUpperCase()) !== -1;

  var remarks = safeStr_(p.remarks);
  var took = 0, toName = '';

  if (giving) {
    toName = safeStr_(p.issuedToName);
    if (!toName) throw new Error('Choose who it is going to.');
    var who = findUserByName_(toName);
    if (!who) {
      throw new Error('"' + toName + '" is not one of the people on this system. ' +
                      'Pick a name from the list.');
    }
    toName = safeStr_(who.Name);

    if (p.receivedQty === undefined || p.receivedQty === null || safeStr_(p.receivedQty) === '') {
      throw new Error('Enter how much ' + toName + ' is taking.');
    }
    took = Number(p.receivedQty);
    if (isNaN(took) || !isFinite(took)) throw new Error('The quantity must be a number.');
    if (took <= 0) {
      throw new Error('Enter a quantity above zero, or answer No if nothing is going out.');
    }
    if (!shelf.listed && took > issued) {
      throw new Error('"' + safeStr_(ind.Part_Name) + '" is not on the ' + ind.Site +
                      ' stock list, so there is no figure to give it out against. ' +
                      'Add it under Stock first.');
    }
    if (took > ceiling) {
      throw new Error('There ' + (onHand === 1 ? 'is' : 'are') + ' only ' + onHand + ' ' +
                      (shelf.unit || unit) + ' of "' + safeStr_(ind.Part_Name) + '" on the shelf at ' +
                      ind.Site + (issued ? ', plus the ' + issued + ' already issued against this indent' : '') +
                      '. You cannot give out ' + took + '.');
    }
  }

  var delta = -(took - issued);                  // the same one rule
  var note  = giving
    ? ('Issued ' + took + ' ' + unit + ' to ' + toName +
       (issued ? ' (' + issued + ' of it handed over at the store)' : '') +
       ', against a restocking indent for ' + safeStr_(ind.Quantity))
    : ('Nothing went out — the ' + safeStr_(ind.Quantity) + ' ' + unit + ' stay on the shelf');

  if (delta !== 0) {
    adjustStock_(ind.Site, ind.Indent_ID, ind.Part_Name, ind.Part_Number, delta,
                 delta < 0 ? STOCK_TXN.ISSUED : STOCK_TXN.RETURNED_TO_STOCK,
                 actor, note, toName);
  }

  advance_(ind, 'CONFIRM_REQUEST', null, actor, STATUS.COMPLETED, {
    Confirmed_By: actor.Name, Confirm_Remarks: remarks,
    Requester_Received_Qty: took, Issued_To_Name: toName
  }, remarks);

  logHistory_(ind.Indent_ID, 'CONFIRM_REQUEST',
    giving ? ('Closed — ' + took + ' ' + unit + ' issued to ' + toName)
           : 'Closed — nothing issued, it all stayed on the shelf',
    'INDENT', actor, ind.Status, STATUS.COMPLETED,
    { restocking: true, gaveAway: giving, issuedTo: toName, takenQty: took,
      issuedQty: issued, orderedQty: ind.Quantity, onShelfBefore: onHand, ceiling: ceiling },
    (remarks ? remarks + ' | ' : '') + note);

  return { status: STATUS.COMPLETED, nextStage: null, restocking: true,
           gaveAway: giving, issuedTo: toName, takenQty: took,
           issuedQty: issued, orderedQty: ind.Quantity, ceiling: ceiling,
           stockNow: derivedStockNow_(ind) };
}

/** The shelf figure right now, worked out from the ledger. */
function derivedStockNow_(ind) {
  var r = findItem_(ind.Site, ind.Part_Name, ind.Part_Number);
  return r ? derivedStockOf_(String(ind.Site).toUpperCase().trim(), r) : '';
}

/** One active person by their name, case-insensitively. */
function findUserByName_(name) {
  var want = String(name || '').trim().toLowerCase();
  if (!want) return null;
  var hit = null;
  readAll_(SH.USERS).forEach(function (u) {
    if (hit || !truthy_(u.Active)) return;
    if (String(u.Name || '').trim().toLowerCase() === want) hit = u;
    else if (String(u.User_ID || '').trim().toLowerCase() === want) hit = u;
  });
  return hit;
}

/** Everything this indent actually put within the requester's reach:
 *  what the store handed over at step 2, plus what was counted on arrival. */
function availableToTake_(ind) {
  var issued = num_(ind.Issued_Qty, 0);
  if (safeStr_(ind.Store_Action) === 'ISSUED_FROM_STOCK') return issued;
  var arrived = safeStr_(ind.Received_Qty) !== ''
    ? num_(ind.Received_Qty, 0)
    : (safeStr_(ind.First_Received_Qty) !== '' ? num_(ind.First_Received_Qty, 0)
                                               : num_(ind.Quantity, 0));
  return issued + arrived;
}

/* ================================================================== */
/*  Cancel                                                             */
/* ================================================================== */

function cancelIndent_(token, p) {
  var actor = requireAuth_(token);
  return withLock_(function () {
    var ind = getIndentOrThrow_(p.indentId);
    var role = String(actor.Role).toUpperCase();
    var isOwner = String(ind.Requester_ID) === String(actor.User_ID);
    if (role !== 'ADMIN' && !(isOwner && String(ind.Current_Stage) === 'STORE_VERIFY')) {
      throw new Error('Only an admin can cancel this indent at its current stage.');
    }
    if ([STATUS.COMPLETED, STATUS.CANCELLED, STATUS.REJECTED].indexOf(String(ind.Status)) !== -1) {
      throw new Error('This indent is already ' + ind.Status + '.');
    }
    var reason = safeStr_(p.remarks) || 'Cancelled';

    /* If the store had already handed goods over and the requester never
       confirmed, those goods are still ours — they go back on the shelf.
       Leaving them off it made the site short with nothing to explain it. */
    var back = num_(ind.Issued_Qty, 0);
    var returned = 0;
    if (back > 0 && safeStr_(ind.Requester_Received_Qty) === '') {
      adjustStock_(ind.Site, ind.Indent_ID, ind.Part_Name, ind.Part_Number, back,
                   STOCK_TXN.RETURNED_TO_STOCK, actor,
                   'Indent cancelled — ' + back + ' ' + safeStr_(ind.Unit) + ' back on the shelf');
      returned = back;
    }

    skipStages_(ind.Indent_ID, STAGES.map(function (s) { return s.key; }), reason);
    advance_(ind, null, null, actor, STATUS.CANCELLED, { Remarks: reason }, reason);
    logHistory_(ind.Indent_ID, ind.Current_Stage, 'Indent cancelled', 'INDENT', actor,
      ind.Status, STATUS.CANCELLED, { returnedToStock: returned }, reason);
    notify_('CANCELLED', findBy_(SH.INDENTS, 'Indent_ID', ind.Indent_ID),
      { actorId: actor.User_ID, note: reason });
    return { status: STATUS.CANCELLED, returnedToStock: returned };
  });
}
