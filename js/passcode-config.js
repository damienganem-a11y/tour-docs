// The settings of the access code (see gate.js).
//
// null  = no access code: the app opens straight away.
// Otherwise it looks like { salt: '...', hash: '...', iterations: 150000 }, made by
//   python3 tools/make_passcode.py "the code"
// It contains a scrambled version of the code, never the code itself.

export const PASSCODE_CONFIG = {
  salt: '882747f650b76d3216466d9f98e2eee0',
  hash: 'b01d7aa96d35b5eb943205c53ba236729a897acbe66b8b5c4b62f85e25f64596',
  iterations: 150000,
};
