function doGet(e) {
  const gate = ggmGate_(e);                        // opened from a GGM Portal tile: signed in already
  return ggmPage_(HtmlService.createTemplateFromFile("main").evaluate(), gate)
    .setTitle('Task Delegation')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


function loadInside(){
  const html = ggmPage_(HtmlService.createTemplateFromFile("main").evaluate(), null);
  html.setWidth(950).setHeight(700)
  const ui = SpreadsheetApp.getUi()
  ui.showModalDialog(html,"BCI Delegation Sheet")
}