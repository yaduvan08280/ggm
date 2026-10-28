function loadPartialHTML_(partial){
  const htmlServ = HtmlService.createTemplateFromFile(partial)
  return htmlServ.evaluate().getContent()
}

function loadFollowUpView(token) {
  ggmUser_(token);
  try {
  return loadPartialHTML_("followup")
  } catch (e) {
    Logger.log(e)
  }
}

function loadAddNewView(token) {
  ggmUser_(token);
  return loadPartialHTML_("new_task")
}

function loadReviseView(token) {
  ggmUser_(token);
  return loadPartialHTML_("revise")
}

function loadPendingTasksView(token) {
  ggmUser_(token);
  return loadPartialHTML_("all_pending")
}