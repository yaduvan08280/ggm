/**********************************************************************
 * File: 09_Lang.gs  —  Hindi for everything that leaves the server:
 *                      Telegram messages and reminder e-mails.
 *
 *  The web pages translate themselves in the browser (see Lang.html);
 *  this file covers the words we send to people who are not looking at
 *  the app at all.
 *********************************************************************/

var HI = {
  /* ---- notification titles and their one-line explanations ---- */
  'New indent raised'              : 'नया इंडेंट आया है',
  'Check the stock and either issue it or forward it to purchase.'
                                   : 'स्टॉक देखें — या तो जारी करें, या खरीद टीम को भेजें।',
  'Forwarded to purchase'          : 'खरीद टीम को भेजा गया',
  'Not in stock. Take quotations or make a direct purchase.'
                                   : 'स्टॉक में नहीं है। कोटेशन लें या सीधी खरीद करें।',
  'Waiting for your approval'      : 'आपकी मंज़ूरी का इंतज़ार है',
  'Quotations are in. Pick the one you are approving.'
                                   : 'कोटेशन आ गए हैं। जिसे मंज़ूरी देनी है उसे चुनें।',
  'Approved — set the ETA'         : 'मंज़ूरी मिल गई — पहुँचने की तारीख़ भरें',
  'Enter the expected arrival and the delivery route.'
                                   : 'सामान कब और किस रास्ते से आएगा, वह भरें।',
  'Sent back for re-quote'         : 'दोबारा कोटेशन के लिए वापस भेजा गया',
  'The admin wants this quoted again.'
                                   : 'एडमिन चाहते हैं कि इसका दोबारा कोटेशन लिया जाए।',
  'Your indent was rejected'       : 'आपका इंडेंट अस्वीकार कर दिया गया',
  'Material on the way'            : 'सामान रास्ते में है',
  'An arrival date has been set. Watch for it.'
                                   : 'पहुँचने की तारीख़ तय हो गई है। ध्यान रखें।',
  'Dispatched — expect delivery'   : 'सामान रवाना हो गया है',
  'Receive it and record the quantity and quality.'
                                   : 'सामान लेकर मात्रा और गुणवत्ता दर्ज करें।',
  'Received at the hub'            : 'हब पर सामान मिल गया',
  'Send it on to the plant with the vehicle details.'
                                   : 'गाड़ी का विवरण भरकर प्लांट भेजें।',
  'On its way to the plant'        : 'प्लांट की ओर रवाना',
  'Check it again when it arrives.': 'पहुँचने पर दोबारा जाँच करें।',
  'Your material has arrived'      : 'आपका सामान आ गया है',
  'Please confirm you have received it, so the indent can close.'
                                   : 'कृपया पुष्टि करें कि सामान मिल गया, ताकि इंडेंट बंद हो सके।',
  'Issued from store stock'        : 'स्टोर स्टॉक से जारी किया गया',
  'Collect it from the store and confirm in the app.'
                                   : 'स्टोर से सामान लें और ऐप में पुष्टि करें।',
  'Indent cancelled'               : 'इंडेंट रद्द कर दिया गया',
  'Follow-up from the coordinator' : 'कोऑर्डिनेटर की ओर से फ़ॉलो-अप',
  'Follow-up reminder'             : 'फ़ॉलो-अप रिमाइंडर',
  'Overdue — still waiting on you' : 'समय बीत चुका है — अब भी आपका इंतज़ार है',
  'Purchased without approval'     : 'बिना मंज़ूरी के खरीद',
  'For your records — the purchase team used their own authority.'
                                   : 'सिर्फ़ जानकारी के लिए — खरीद टीम ने अपने अधिकार से खरीदा।',
  'Bought over the counter'        : 'दुकान से सीधे खरीदा गया',
  'The purchaser has it in hand and is sending it to the station.'
                                   : 'सामान खरीद टीम के पास है और स्टेशन भेजा जा रहा है।',

  /* ---- the message body ---- */
  'Qty'                            : 'मात्रा',
  'Raised by'                      : 'माँग करने वाले',
  'Priority'                       : 'प्राथमिकता',
  'Vendor'                         : 'विक्रेता',
  'Now at step'                    : 'अभी चरण',
  'past its due time.'             : 'समय बीत चुका है।',
  'min'                            : 'मिनट',

  /* ---- stage names ---- */
  'Indent Raised'                  : 'इंडेंट दर्ज',
  'Store Verification'             : 'स्टोर जाँच',
  'Purchase / Quotations'          : 'खरीद / कोटेशन',
  'Admin Approval'                 : 'एडमिन मंज़ूरी',
  'Set ETA & Logistics'            : 'पहुँच तारीख़ व रास्ता',
  'Dispatch Follow-Up'             : 'रवानगी फ़ॉलो-अप',
  'Receive & Check'                : 'सामान लेना व जाँच',
  'Receive & Check Jaipur'         : 'जयपुर में सामान लेना व जाँच',
  'Send To Station'                : 'स्टेशन भेजें',
  'Plant Receipt & Check'          : 'प्लांट पर जाँच',
  'Confirm With Requester'         : 'माँग करने वाले से पुष्टि',

  /* ---- statuses ---- */
  'PENDING_STORE_VERIFICATION'     : 'स्टोर जाँच बाकी',
  'ISSUED_FROM_STOCK'              : 'स्टॉक से जारी',
  'SENT_TO_PURCHASE'               : 'खरीद टीम के पास',
  'PENDING_ADMIN_APPROVAL'         : 'एडमिन मंज़ूरी बाकी',
  'APPROVED_WAITING_DISPATCH'      : 'मंज़ूर — रवानगी बाकी',
  'ETA_SET'                        : 'पहुँच तारीख़ तय',
  'IN_TRANSIT'                     : 'रास्ते में',
  'BOUGHT_AT_SHOP'                 : 'दुकान से खरीदा',
  'RECEIVED_AT_HUB'                : 'हब पर प्राप्त',
  'IN_TRANSIT_TO_PLANT'            : 'प्लांट की ओर',
  'RECEIVED_AT_PLANT'              : 'प्लांट पर प्राप्त',
  'COMPLETED'                      : 'पूर्ण',
  'REJECTED'                       : 'अस्वीकृत',
  'CANCELLED'                      : 'रद्द',

  /* ---- the bot's own replies ---- */
  'Connected.'                     : 'जुड़ गया।',
  'Hello'                          : 'नमस्ते',
  'You will now get a message here the moment an indent needs you.'
                                   : 'अब जब भी किसी इंडेंट में आपकी ज़रूरत होगी, यहीं सूचना मिलेगी।',
  'Test message'                   : 'परीक्षण संदेश',
  'notifications are working.'     : 'सूचनाएँ काम कर रही हैं।',
  'You will get a message here whenever an indent needs you.'
                                   : 'जब भी किसी इंडेंट में आपकी ज़रूरत होगी, यहाँ संदेश आएगा।',
  'What you have to do:'           : 'आपको क्या करना है:',
  'Step'                           : 'चरण',
  'Status'                         : 'स्थिति',
  'Plant'                          : 'प्लांट',
  'Open in Indent Flow'            : 'ऐप में खोलें',
  'Follow-up due'                  : 'फ़ॉलो-अप का समय',
  'Quantity'                       : 'मात्रा',
  'Current status'                 : 'मौजूदा स्थिति',
  'WHAT YOU HAVE TO DO'            : 'आपको क्या करना है',
  'FOLLOW-UP REMINDER'             : 'फ़ॉलो-अप रिमाइंडर',
  'Set by'                         : 'सेट किया',
  'scheduled for'                  : 'नियत समय'
};

/** Translate one phrase for a language code. Unknown phrases pass through. */
function tr_(phrase, lang) {
  if (String(lang || 'EN').toUpperCase() !== 'HI') return phrase;
  var hit = HI[phrase];
  return hit === undefined ? phrase : hit;
}

/** The language a user reads in. */
function langOf_(user) {
  var l = user ? String(user.Language || '').toUpperCase() : '';
  return isLang_(l) ? l : 'EN';
}

function setLanguage_(token, lang) {
  var u = requireAuth_(token);
  lang = String(lang || '').toUpperCase();
  if (!isLang_(lang)) throw new Error('Unknown language: ' + lang);
  update_(SH.USERS, u.__row, { Language: lang });
  return { language: lang };
}

/** Admin can set it for somebody else — useful when setting an account up. */
function setLanguageFor_(token, userId, lang) {
  requireRole_(token, ['ADMIN']);
  lang = String(lang || '').toUpperCase();
  if (!isLang_(lang)) throw new Error('Unknown language: ' + lang);
  var u = findBy_(SH.USERS, 'User_ID', safeStr_(userId));
  if (!u) throw new Error('No such user: ' + userId);
  update_(SH.USERS, u.__row, { Language: lang });
  return { userId: u.User_ID, language: lang };
}

function languages_() {
  return LANGUAGES.map(function (l) {
    return { code: l.code, label: l.label, native: l.native, locale: l.locale };
  });
}
