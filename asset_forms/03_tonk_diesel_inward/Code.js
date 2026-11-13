// Dropdowns come from the "For Forms" tab of the Asset sheet. Every site has its own
// columns there (row 2 = site, row 3 = category, names from row 4 down with no row limit),
// so this reads the site's columns by their headings, top to bottom.
var ASSET_SHEET_ID = '1ZkXxIEP4mqUu4zF1WwVAMYHLzBG8gaGCLPxIB_kkXC8';
var FORMS_SITE = 'TONK';

/** Names in FORMS_SITE's For Forms columns for these categories, without blanks or repeats.
 *  byColumn: all of the first category, then the next; otherwise row by row across them. */
function forFormsNames_(cats, byColumn) {
  var sh = SpreadsheetApp.openById(ASSET_SHEET_ID).getSheetByName('For Forms');
  if (!sh) throw new Error('The Asset sheet has no "For Forms" tab.');
  var width = sh.getLastColumn(), last = sh.getLastRow();
  var head = sh.getRange(2, 1, 2, width).getDisplayValues();
  var cols = {}, site = '';
  for (var c = 0; c < width; c++) {
    var s = String(head[0][c]).trim().toUpperCase(), h = String(head[1][c]).trim().toUpperCase();
    if (s) site = s;
    if (!h) { if (!s) site = ''; continue; }
    if (site === FORMS_SITE) cols[h] = c;
  }
  var want = cats.map(function (k) {
    if (cols[k] == null) throw new Error('"For Forms" has no ' + k + ' column for ' + FORMS_SITE + '.');
    return cols[k];
  });
  var rows = last >= 4 ? sh.getRange(4, 1, last - 3, width).getDisplayValues() : [];
  var out = [];
  if (byColumn) want.forEach(function (c) { rows.forEach(function (r) { out.push(r[c]); }); });
  else rows.forEach(function (r) { want.forEach(function (c) { out.push(r[c]); }); });
  out = out.map(function (v) { return String(v).trim(); })
           .filter(function (v) { return v !== '' && v !== '#N/A' && v !== 'Vehicle Numbers'; });
  return out.filter(function (v, i) { return out.indexOf(v) === i; });
}

/** Set the choices of the form's dropdown with this exact title (an empty list keeps the old ones). */
function setDropdown_(title, list) {
  if (!list.length) return;
  FormApp.getActiveForm().getItems().forEach(function (item) {
    if (item.getTitle() === title && item.getType() === FormApp.ItemType.LIST) item.asListItem().setChoiceValues(list);
  });
}

function updateFormDropdowns2() {
  setDropdown_('Truck Number', forFormsNames_(['DUMPERS']));
}
