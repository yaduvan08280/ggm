// Function 1: To add a new task from the Web App
function saveNewTaskWebApp_(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet();
  // Ensure the sheet name matches your exact tab name. I am using "Master".
  var masterSheet = sheet.getSheetByName("Master");

  var lastRow = masterSheet.getLastRow();
  var maxNum = 0;

  // Generate a new Task ID (e.g., TK-001, TK-045)
  if (lastRow > 1) {
    var sheetData = masterSheet.getRange(2, 2, lastRow - 1, 1).getValues();
    for (var i = 0; i < sheetData.length; i++) {
      var idStr = sheetData[i][0] ? sheetData[i][0].toString().trim() : "";
      if (idStr.indexOf("TK-") === 0) {
        var numPart = parseInt(idStr.substring(3), 10);
        if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
      }
    }
  }

  var nextNum = maxNum + 1;
  var nextNumStr = nextNum.toString();
  while (nextNumStr.length < 3) nextNumStr = "0" + nextNumStr;
  var taskId = "TK-" + nextNumStr;

  var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");

  // Format the date strictly to dd/mm/yyyy
  let formattedDate = data.date;
  if (data.date && data.date.includes("-")) {
    let parts = data.date.split("-");
    if (parts.length === 3) formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  // Get the email of the person assigning the task
  var givenBy = Session.getActiveUser().getEmail();

  // Create the exact row array based on your columns A to K
  var rowData = [
    todayStr,         // Column A: Creation Date
    taskId,           // Column B: Task ID
    data.name,        // Column C: Name
    data.task,        // Column D: Task
    formattedDate,    // Column E: First Date
    "",               // Column F: Revision 1 (Blank initially)
    "",               // Column G: Revision 2 (Blank initially)
    formattedDate,    // Column H: Latest Revision
    0,                // Column I: Total Revisions (Starts at 0)
    "Pending",        // Column J: Status
    givenBy           // Column K: Given By
  ];

  masterSheet.appendRow(rowData);
  return true;
}


// Function 2: To revise the planned date and update the revision columns
function updateRevisedTask_(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet();
  var masterSheet = sheet.getSheetByName("Master");
  var lastRow = masterSheet.getLastRow();

  if (lastRow < 2) throw new Error("The sheet is empty.");

  // Fetch all data from Column A to Column I to check revisions
  var range = masterSheet.getRange(2, 1, lastRow - 1, 9);
  var values = range.getValues();

  for (var i = 0; i < values.length; i++) {
    var currentTaskId = values[i][1]; // Task ID is in Column B (Index 1)

    if (currentTaskId === data.id) {
      var rowIndex = i + 2; // Exact row number in the sheet

      // Format the incoming date
      let formattedDate = data.date;
      if (data.date && data.date.includes("-")) {
        let parts = data.date.split("-");
        if (parts.length === 3) formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }

      // Read current Total Revisions from Column I (Index 8)
      var currentRevisions = parseInt(values[i][8]) || 0;
      var newRevisionsCount = currentRevisions + 1;

      // Update Column H (Latest Revision)
      masterSheet.getRange(rowIndex, 8).setValue(formattedDate);

      // Update Column I (Total Revisions)
      masterSheet.getRange(rowIndex, 9).setValue(newRevisionsCount);

      // Distribute to Column F (Revision 1) or Column G (Revision 2) based on count
      if (newRevisionsCount === 1) {
        masterSheet.getRange(rowIndex, 6).setValue(formattedDate); // Column F
      } else if (newRevisionsCount === 2) {
        masterSheet.getRange(rowIndex, 7).setValue(formattedDate); // Column G
      }

      return true;
    }
  }

  throw new Error("Task ID not found in the database.");
}