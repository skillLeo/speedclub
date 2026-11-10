// The newest code mailed to EMAIL, from the local mailbox (GET /dev/mail/latest, local and testing only).
// Sets output.code; fails while no mail with a new code is there, so the flow can retry it.
// Runs in Maestro's GraalJS: http, json and output are its globals, the rest come from `env` in the flow.
/* global http, json, output, API_URL, EMAIL, PREVIOUS */
const response = http.get(API_URL + '/dev/mail/latest?to=' + encodeURIComponent(EMAIL));
if (response.status !== 200) {
  throw new Error('no mail to ' + EMAIL + ' yet (HTTP ' + response.status + ')');
}
const mail = json(response.body);
if (!mail.code || mail.code === PREVIOUS) {
  throw new Error('the newest mail to ' + EMAIL + ' carries no new code');
}
output.code = mail.code;
