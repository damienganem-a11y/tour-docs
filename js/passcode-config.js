// The settings of the access code (see gate.js).
//
// null  = no access code: the app opens straight away.
// Otherwise it looks like { salt: '...', hash: '...', iterations: 150000 }, made by
//   python3 tools/make_passcode.py "the code"
// It contains a scrambled version of the code, never the code itself.

export const PASSCODE_CONFIG = {
  salt: '8de7e1c3c2683f6f903731fb6b1b57c6',
  hash: '4ba539e34a2d8fb624b2b6e17020871169f6627386731c69367623f4a39a1259',
  iterations: 150000,
};
