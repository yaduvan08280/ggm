/**********************************************************************
 * File: 12_Transfers.gs — moving goods between two sites.
 *
 *  No indent is raised for these. One storekeeper puts something on a
 *  lorry; another counts it off at the far end. Two shelves change and
 *  nothing is bought, so the whole indent pipeline is beside the point.
 *
 *  THE ONE RULE THIS FILE EXISTS TO KEEP
 *  -------------------------------------
 *  Across the two sites, nothing is created and nothing vanishes.
 *
 *      sender's shelf  −N        at the moment it leaves
 *      receiver's shelf +N       at the moment it is counted in
 *
 *  Between those two moments the goods are on NEITHER shelf. That gap is
 *  deliberate and it is honest: they are on a lorry. A figure that
 *  claimed they were still at Tonk would send somebody looking for them
 *  in a rack they had already left.
 *
 *  Because of that, the receiving storekeeper must enter the SAME number
 *  that was sent. A mismatch is not a data-entry problem to be rounded
 *  away — it means goods are missing, and the two of them have to sort
 *  that out between themselves before the books will close on it.
 *********************************************************************/

/** The four sites a person may send to — every site except their own. */
function transferTargets_(fromSite) {
  var from = String(fromSite || '').toUpperCase().trim();
  return siteList_().filter(function (s) { return s !== from; });
}

function shapeTransfer_(r) {
  return {
    id        : safeStr_(r.Transfer_ID),
    fromSite  : safeStr_(r.From_Site),
    toSite    : safeStr_(r.To_Site),
    name      : safeStr_(r.Item_Name),
    partNumber: safeStr_(r.Part_Number),
    unit      : safeStr_(r.Unit) || 'NOS',
    section   : safeStr_(r.Section),
    quantity  : num_(r.Quantity, 0),
    receivedQty: safeStr_(r.Received_Qty) === '' ? '' : num_(r.Received_Qty, 0),
    status    : safeStr_(r.Status),
    sentBy    : safeStr_(r.Sent_By), sentById: safeStr_(r.Sent_By_ID),
    sentAt    : iso_(r.Sent_At), sentRemarks: safeStr_(r.Sent_Remarks),
    receivedBy: safeStr_(r.Received_By), receivedAt: iso_(r.Received_At),
    receiveRemarks: safeStr_(r.Receive_Remarks),
    decidedBy : safeStr_(r.Decided_By), decidedAt: iso_(r.Decided_At),
    cancelReason: safeStr_(r.Cancel_Reason),
    itemRequestId: safeStr_(r.Item_Request_ID),
    photos    : transferPhotos_(safeStr_(r.Transfer_ID))
  };
}

/** The photographs attached to one transfer, both ends of it.
 *  They live in the same Attachments register as an indent's, keyed by the
 *  transfer's own id — the column is called Indent_ID for historical
 *  reasons, but it has always meant "the thing this is attached to", and
 *  a TRF- id can never collide with an IND- one. */
function transferPhotos_(id) {
  if (!id) return [];
  return readWhere_(SH.ATTACH, function (a) { return String(a.Indent_ID) === String(id); })
    .map(shapeAttachment_);
}

/* ==================================================================
   The list
   ================================================================== */
function listTransfers_(token, p) {
  var actor = requireRole_(token, ['STORE', 'PURCHASE', 'ADMIN']);
  p = p || {};
  var sites = sitesVisibleTo_(actor);
  var mine  = String(actor.Site || '').toUpperCase().trim();
  var isStore = String(actor.Role).toUpperCase() === 'STORE';

  var all = readAll_(SH.TRANSFERS).map(shapeTransfer_).filter(function (t) {
    // a storekeeper sees only what touches their own site, either end
    if (isStore) return t.fromSite === mine || t.toSite === mine;
    if (safeStr_(p.site)) {
      var want = String(p.site).toUpperCase();
      return t.fromSite === want || t.toSite === want;
    }
    return true;
  });

  var q = safeStr_(p.q).toLowerCase();
  if (q) {
    all = all.filter(function (t) {
      return (t.id + ' ' + t.name + ' ' + t.partNumber + ' ' + t.sentBy + ' ' +
              t.fromSite + ' ' + t.toSite).toLowerCase().indexOf(q) !== -1;
    });
  }
  all.sort(function (a, b) { return (a.sentAt < b.sentAt) ? 1 : -1; });

  /* Split by what the reader has to DO about each one, not by status —
     "three waiting on you" is the only number that makes somebody act. */
  var here = isStore ? mine : String(p.site || '').toUpperCase();
  function waitingOnMe(t) {
    if (t.status !== TRANSFER_STATUS.IN_TRANSIT) return false;
    if (isStore) return t.toSite === mine;
    return false;                       // purchase and admin watch, they do not receive
  }

  return {
    site    : mine && isSite_(mine) ? mine : here,
    sites   : sites,
    isStore : isStore,
    canSend : isStore && isSite_(mine),
    canCancel: String(actor.Role).toUpperCase() === 'ADMIN',
    targets : isSite_(mine) ? transferTargets_(mine) : siteList_(),
    incoming: all.filter(waitingOnMe),
    rows    : all,
    counts  : {
      incoming : all.filter(waitingOnMe).length,
      inTransit: all.filter(function (t) { return t.status === TRANSFER_STATUS.IN_TRANSIT; }).length,
      awaiting : all.filter(function (t) { return t.status === TRANSFER_STATUS.AWAITING_ITEM; }).length,
      received : all.filter(function (t) { return t.status === TRANSFER_STATUS.RECEIVED; }).length
    }
  };
}

/** How many transfers are sitting on this person's doorstep, for the badge. */
function incomingTransferCount_(actor) {
  if (String(actor.Role).toUpperCase() !== 'STORE') return 0;
  var mine = String(actor.Site || '').toUpperCase().trim();
  if (!isSite_(mine)) return 0;
  return readWhere_(SH.TRANSFERS, function (r) {
    return String(r.To_Site).toUpperCase().trim() === mine &&
           String(r.Status) === TRANSFER_STATUS.IN_TRANSIT;
  }).length;
}

/* ==================================================================
   Sending
   ================================================================== */
function sendTransfer_(token, p) {
  var actor = requireRole_(token, ['STORE', 'ADMIN']);
  return withLock_(function () {
    p = p || {};
    var from = inventorySiteFor_(actor, p.fromSite, true);
    if (!canEditInventory_(actor, from)) {
      throw new Error('You can only send goods out of your own site.');
    }

    var to = String(p.toSite || '').toUpperCase().trim();
    if (!to) throw new Error('Choose the site you are sending it to.');
    if (!isSite_(to)) throw new Error('"' + safeStr_(p.toSite) + '" is not one of the four sites.');
    if (to === from) {
      throw new Error('That is the site you are sending from. Pick a different one.');
    }

    /* It has to be something this site actually keeps, because the figure
       it comes off has to exist before anything can come off it. */
    var name = safeStr_(p.name);
    var part = safeStr_(p.partNumber);
    if (!name && !part) throw new Error('Choose the item you are sending.');
    var row = safeStr_(p.code) ? findBy_(invSheet_(from), 'Item_Code', safeStr_(p.code))
                               : findItem_(from, name, part);
    if (!row) {
      throw new Error('"' + (name || part) + '" is not on the ' + from + ' item list, so there ' +
                      'is no stock figure to send it out of. Add it under Stock first.');
    }
    var item = shapeItem_(row, from);

    var qty = Number(p.quantity);
    if (safeStr_(p.quantity) === '' || isNaN(qty) || !isFinite(qty)) {
      throw new Error('How much are you sending? Enter a number.');
    }
    if (qty <= 0) throw new Error('The quantity must be more than zero.');
    if (qty > item.stock) {
      throw new Error('There ' + (item.stock === 1 ? 'is' : 'are') + ' only ' + item.stock + ' ' +
                      item.unit + ' of "' + item.name + '" on the shelf at ' + from +
                      '. You cannot send ' + qty + '.');
    }

    /* A photograph is the only evidence of what actually went on the
       vehicle, and the far end has nothing else to check against. */
    var shots = (p.photos || (p.photo ? [p.photo] : [])).filter(function (x) { return x && x.data; });
    if (!shots.length) {
      throw new Error('Attach at least one photo of the material. It is what the other site ' +
                      'checks against when it arrives.');
    }

    var id = nextId_(SH.TRANSFERS, 'Transfer_ID', 'TRF', 4);
    var t  = now_();

    insert_(SH.TRANSFERS, {
      Transfer_ID: id, From_Site: from, To_Site: to,
      Item_Name: item.name, Part_Number: item.partNumber, Unit: item.unit,
      Section: item.section,
      Quantity: qty, Received_Qty: '', Status: TRANSFER_STATUS.IN_TRANSIT,
      Sent_By_ID: actor.User_ID, Sent_By: actor.Name, Sent_At: t,
      Sent_Remarks: safeStr_(p.remarks),
      Received_By_ID: '', Received_By: '', Received_At: '', Receive_Remarks: '',
      Decided_By: '', Decided_At: '', Cancel_Reason: '', Item_Request_ID: ''
    });

    attachPhotos_(id, 'SITE_TRANSFER', 'TRANSFER_OUT', shots, actor);

    // off the shelf here, the moment it leaves
    adjustStock_(from, id, item.name, item.partNumber, -qty,
                 STOCK_TXN.TRANSFER_OUT, actor,
                 'Sent to ' + to + (safeStr_(p.remarks) ? ' — ' + safeStr_(p.remarks) : ''),
                 to);

    notifyTransfer_('TRANSFER_SENT', findBy_(SH.TRANSFERS, 'Transfer_ID', id), to, actor,
      actor.Name + ' has sent ' + qty + ' ' + item.unit + ' of "' + item.name + '" from ' +
      from + '. Count it off the vehicle and receive it.');

    return { transferId: id, fromSite: from, toSite: to, quantity: qty,
             name: item.name, partNumber: item.partNumber, unit: item.unit,
             stockNow: derivedStockOf_(from, findBy_(invSheet_(from), 'Item_Code', item.code)) };
  });
}

/* ==================================================================
   Receiving
   ================================================================== */
function receiveTransfer_(token, p) {
  var actor = requireRole_(token, ['STORE', 'ADMIN']);
  return withLock_(function () {
    p = p || {};
    var r = findBy_(SH.TRANSFERS, 'Transfer_ID', safeStr_(p.transferId));
    if (!r) throw new Error('No such transfer.');
    if (String(r.Status) !== TRANSFER_STATUS.IN_TRANSIT) {
      throw new Error('That transfer is already ' + String(r.Status).toLowerCase().replace(/_/g, ' ') + '.');
    }
    var to = String(r.To_Site).toUpperCase().trim();
    if (String(actor.Role).toUpperCase() !== 'ADMIN') {
      var mine = String(actor.Site || '').toUpperCase().trim();
      if (mine !== to) {
        throw new Error('This is going to ' + to + ', and you look after ' + (mine || 'no site') +
                        '. The ' + to + ' store team receive it.');
      }
    }

    var sent = num_(r.Quantity, 0);
    if (p.receivedQty === undefined || p.receivedQty === null || safeStr_(p.receivedQty) === '') {
      throw new Error('Count what came off the vehicle and enter it.');
    }
    var got = Number(p.receivedQty);
    if (isNaN(got) || !isFinite(got)) throw new Error('The quantity must be a number.');

    /* The count has to match. Booking a different number would quietly
       create or destroy stock between the two sites, and the app would be
       the last place anybody looked for the missing units. */
    if (got !== sent) {
      throw new Error(safeStr_(r.From_Site) + ' sent ' + sent + ' ' + safeStr_(r.Unit) +
                      ' and you have counted ' + got + '. Sort out the difference with ' +
                      safeStr_(r.Sent_By) + ' before receiving it — one of the two counts is ' +
                      'wrong, or ' + Math.abs(sent - got) + ' ' + safeStr_(r.Unit) +
                      ' went missing on the way.');
    }

    var shots = (p.photos || (p.photo ? [p.photo] : [])).filter(function (x) { return x && x.data; });
    if (!shots.length) {
      throw new Error('Attach at least one photo of what you received.');
    }
    attachPhotos_(r.Transfer_ID, 'SITE_TRANSFER', 'TRANSFER_IN', shots, actor);

    var t = now_();
    var patch = {
      Received_Qty: got, Received_By_ID: actor.User_ID, Received_By: actor.Name,
      Received_At: t, Receive_Remarks: safeStr_(p.remarks)
    };

    /* Does the receiving site already keep this? Name OR part number is
       enough — the two sites rarely spell a thing the same way, and the
       part number is the one they do agree on. */
    var existing = findItem_(to, safeStr_(r.Item_Name), safeStr_(r.Part_Number));
    if (existing) {
      update_(SH.TRANSFERS, r.__row, extend_(patch, { Status: TRANSFER_STATUS.RECEIVED }));
      landTransfer_(findBy_(SH.TRANSFERS, 'Transfer_ID', r.Transfer_ID), actor);
      notifyTransfer_('TRANSFER_RECEIVED', findBy_(SH.TRANSFERS, 'Transfer_ID', r.Transfer_ID),
        safeStr_(r.From_Site), actor,
        actor.Name + ' counted in all ' + got + ' ' + safeStr_(r.Unit) + ' at ' + to + '.');
      return { transferId: r.Transfer_ID, status: TRANSFER_STATUS.RECEIVED, receivedQty: got,
               listed: true, itemName: safeStr_(existing.Item_Name),
               stockNow: derivedStockOf_(to, findBy_(invSheet_(to), 'Item_Code', existing.Item_Code)) };
    }

    /* Nothing on this site's list matches. The goods are real and they are
       standing here, but there is no row to hold them — and a row on an
       item list is the administrator's to grant. So the transfer waits,
       the stock stays in transit rather than being invented, and the
       moment the item is approved it lands by itself. */
    var req = requestItemChange_(actor, to, null, {
      Item_Name    : safeStr_(r.Item_Name),
      Part_Number  : safeStr_(r.Part_Number),
      Unit         : safeStr_(r.Unit) || 'NOS',
      Section      : resolveSection_(to, safeStr_(r.Section)),
      Initial_Stock: 0,
      Notes        : 'Added for transfer ' + r.Transfer_ID + ' from ' + safeStr_(r.From_Site),
      __transferId : r.Transfer_ID
    }, 'ADD');

    update_(SH.TRANSFERS, r.__row, extend_(patch, {
      Status: TRANSFER_STATUS.AWAITING_ITEM, Item_Request_ID: req.requestId
    }));

    notifyTransfer_('TRANSFER_RECEIVED', findBy_(SH.TRANSFERS, 'Transfer_ID', r.Transfer_ID),
      safeStr_(r.From_Site), actor,
      actor.Name + ' counted in all ' + got + ' ' + safeStr_(r.Unit) + ' at ' + to +
      ', but "' + safeStr_(r.Item_Name) + '" is not on the ' + to + ' list yet — the ' +
      'administrator has to add it before the stock can land.');

    return { transferId: r.Transfer_ID, status: TRANSFER_STATUS.AWAITING_ITEM, receivedQty: got,
             listed: false, requestId: req.requestId,
             message: '"' + safeStr_(r.Item_Name) + '" is not on the ' + to + ' item list yet. ' +
                      'It has gone to the administrator; the ' + got + ' ' + safeStr_(r.Unit) +
                      ' land on your shelf as soon as they approve it.' };
  });
}

/** Put a received transfer onto the destination shelf. Called once the
 *  item is known to exist there — either straight away, or later, when
 *  the administrator approves the item that was waiting for them. */
function landTransfer_(r, actor) {
  var to  = String(r.To_Site).toUpperCase().trim();
  var got = num_(r.Received_Qty, 0);
  if (got <= 0) return;
  adjustStock_(to, r.Transfer_ID, safeStr_(r.Item_Name), safeStr_(r.Part_Number), got,
               STOCK_TXN.TRANSFER_IN, actor,
               'Received from ' + safeStr_(r.From_Site) +
               (safeStr_(r.Receive_Remarks) ? ' — ' + safeStr_(r.Receive_Remarks) : ''));
}

/** A transfer parked on an item request lands the moment that request is
 *  approved. Called from decideItemRequest_ so nobody has to remember. */
function landTransfersWaitingOn_(requestId, actor) {
  var landed = [];
  readWhere_(SH.TRANSFERS, function (r) {
    return String(r.Item_Request_ID) === String(requestId) &&
           String(r.Status) === TRANSFER_STATUS.AWAITING_ITEM;
  }).forEach(function (r) {
    landTransfer_(r, actor);
    update_(SH.TRANSFERS, r.__row, { Status: TRANSFER_STATUS.RECEIVED });
    landed.push(safeStr_(r.Transfer_ID));
  });
  return landed;
}

/** A transfer whose item request was turned down has nowhere to land, so
 *  it goes back where it came from rather than sitting in limbo. */
function returnTransfersWaitingOn_(requestId, actor, why) {
  var sent = [];
  readWhere_(SH.TRANSFERS, function (r) {
    return String(r.Item_Request_ID) === String(requestId) &&
           String(r.Status) === TRANSFER_STATUS.AWAITING_ITEM;
  }).forEach(function (r) {
    putTransferBack_(r, actor, why || 'The item was not approved for the receiving site.');
    sent.push(safeStr_(r.Transfer_ID));
  });
  return sent;
}

/* ==================================================================
   Cancelling
   ================================================================== */
function cancelTransfer_(token, p) {
  var actor = requireRole_(token, ['ADMIN']);
  return withLock_(function () {
    var r = findBy_(SH.TRANSFERS, 'Transfer_ID', safeStr_(p && p.transferId));
    if (!r) throw new Error('No such transfer.');
    if (String(r.Status) === TRANSFER_STATUS.RECEIVED) {
      throw new Error('That transfer has already been received at ' + safeStr_(r.To_Site) +
                      '. Send it back as a transfer of its own rather than cancelling this one.');
    }
    if (String(r.Status) === TRANSFER_STATUS.CANCELLED) {
      throw new Error('That transfer was already cancelled.');
    }
    var why = safeStr_(p.reason);
    if (!why) throw new Error('Say why it is being cancelled, so both sites know.');

    putTransferBack_(r, actor, why);
    return { transferId: safeStr_(r.Transfer_ID), status: TRANSFER_STATUS.CANCELLED };
  });
}

/** Put the quantity back on the sending shelf and close the transfer. */
function putTransferBack_(r, actor, why) {
  var from = String(r.From_Site).toUpperCase().trim();
  var qty  = num_(r.Quantity, 0);

  adjustStock_(from, safeStr_(r.Transfer_ID), safeStr_(r.Item_Name), safeStr_(r.Part_Number),
               qty, STOCK_TXN.TRANSFER_IN, actor,
               'Transfer to ' + safeStr_(r.To_Site) + ' cancelled — ' + why);

  update_(SH.TRANSFERS, r.__row, {
    Status: TRANSFER_STATUS.CANCELLED,
    Decided_By: actor.Name, Decided_At: now_(), Cancel_Reason: why
  });

  var fresh = findBy_(SH.TRANSFERS, 'Transfer_ID', safeStr_(r.Transfer_ID));
  [safeStr_(r.From_Site), safeStr_(r.To_Site)].forEach(function (site) {
    notifyTransfer_('TRANSFER_CANCELLED', fresh, site, actor,
      actor.Name + ' cancelled it — ' + why + '. The ' + qty + ' ' + safeStr_(r.Unit) +
      ' are back on the ' + from + ' shelf.');
  });
}

/* ==================================================================
   Telling the other site
   ------------------------------------------------------------------
   notify_ scopes a role to a site by reading `.Site` off what it is
   given. A transfer has two sites and the message is nearly always for
   the OTHER one, so it is handed a stand-in carrying whichever site
   should hear about it.
   ================================================================== */
function notifyTransfer_(eventKey, r, site, actor, note) {
  if (!r) return 0;
  return notify_(eventKey, {
    Indent_ID   : safeStr_(r.Transfer_ID),
    Site        : String(site || '').toUpperCase().trim(),
    Section     : safeStr_(r.Section),
    Part_Name   : safeStr_(r.Item_Name),
    Part_Number : safeStr_(r.Part_Number),
    Quantity    : safeStr_(r.Quantity),
    Unit        : safeStr_(r.Unit),
    Requested_By: safeStr_(r.Sent_By),
    Priority    : 'NORMAL',
    Current_Stage: ''
  }, { actorId: actor ? actor.User_ID : '', note: note });
}
