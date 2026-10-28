function groupBy(list, keyGetter) {
    const map = new Map();
    list.forEach((item) => {
         const key = keyGetter(item);
         const collection = map.get(key);
         if (!collection) {
             map.set(key, [item]);
         } else {
             collection.push(item);
         }
    });
    return map;
}

function testEmail() { portalAssertEditor_();
  Logger.log(getEmail("Ravi","Accounts"))
}

function getEmail(theName,theDepartment) {
  try {
  let ss = SpreadsheetApp.getActiveSpreadsheet()
  let sheet = ss.getSheetByName("Doer List")
  let data = sheet.getRange(1,1,sheet.getLastRow(),3).getValues()
  let email = data.filter(r => r[0] === theName && r[1] === theDepartment)[0][2]
  return email
  } catch (e) {
    Browser.msgBox("There is a mismatch in Doer Details in Task list: Doer Name - " + theName + ", Doer Department - " + theDepartment)
    return "FAILED"
  }
}


function findinB(name, data) {
  var valB = name
  for (nn = 0; nn < data.length; ++nn) {
    if (data[nn][1] == valB) { break };// if a match in column B is found, break the loop
  }
  return data[nn][0];// show column A
}

function getLastRowSpecial(range) {
  var rowNum = 0;
  var blank = false;
  for (var row = 0; row < range.length; row++) {
    if (range[row][0] === "" && !blank) {
      rowNum = row;
      blank = true;
    } else if (range[row][0] !== "") {
      blank = false;
    };
  };
  return rowNum;
};

function Return_Date(F_Date, num, hr, min) {//Return_Date(F_Date,num)
  var dt = new Date(F_Date.getTime() + 24 * 60 * 60 * 1000 * (num + 1));
  dt.setHours(hr);//new Line
  dt.setMinutes(min);//new Line
  return dt;
}

function getDayInfo(arg){
  if (arg === 1) {
    return "monday"
  } else if (arg === 2) {
    return "tuesday"
  } else if (arg === 3) {
    return "wednesday"
  } else if (arg === 4) {
    return "thursday"
  } else if (arg === 5) {
    return "friday"
  } else if (arg === 6) {
    return "saturday"
  } else if (arg === 0) {
    return "sunday"
  }
}

function testing(){ portalAssertEditor_();
  let a = Date.parse("4/5/2022")
  let day = getDayInfo(a.getDay())
  Logger.log(eval("Date.parse(a).next().month().first().saturday()"))
}


function importFromPrevious(){ portalAssertEditor_();
  let ss = SpreadsheetApp.getActiveSpreadsheet()
  let importURL = ss.getSheetByName("ImportChecklist").getRange("B2").getValue()
  let otherSheet = SpreadsheetApp.openByUrl(importURL)
  let otherMaster = otherSheet.getSheetByName("Master")
  let otherMasterData = otherMaster.getRange(2,1,otherMaster.getLastRow()-1,6).getValues()
  let finalData = otherMasterData.filter(r => !r[5])
  let currMaster = ss.getSheetByName("Master")
  let row = finalData.length;
  let column = finalData[0].length;
  currMaster.getRange(currMaster.getLastRow()+1, 1, row, column).setValues(finalData);
}
