// The access code: a simple gate for the online version of the app.
//
// What it is: a screen that asks for a code before the app opens, and remembers the phone for
// 30 days. It works without internet. It keeps casual visitors out.
// What it is NOT: real security. The app's files are public on the internet, so anyone technical
// can read them and get around this screen. Real protection (accounts) comes in phase 2. Your trips
// never leave your phone, so a visitor cannot see them either way.
//
// The code itself is never stored anywhere in the app. Only a scrambled version (a "hash") is,
// in js/passcode-config.js, made with tools/make_passcode.py.

const REMEMBER_DAYS = 30;
const KEY = 'tourdocs.unlockedUntil'; // where the phone remembers that the code was entered

// The browser only offers the scrambling tools on secure (https) pages. On a plain http page, for
// example when testing over home wifi, the gate stays off.
export const gateAvailable = () => Boolean(globalThis.crypto?.subtle);

const toHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g).map((pair) => parseInt(pair, 16)));

// Scrambles a code with a salt (PBKDF2, SHA-256): the same code and salt always give the same result,
// and nobody can get the code back from the result.
export async function hashPasscode(code, saltHex, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code.trim()), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations }, key, 256);
  return toHex(bits);
}

// Makes the settings for a new code: { salt, hash, iterations }. (tools/make_passcode.py does the same thing.)
export async function makePasscodeConfig(code, iterations = 150000) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await hashPasscode(code, salt, iterations), iterations };
}

// Is this the right code? config is { salt, hash, iterations } from js/passcode-config.js.
export async function checkPasscode(code, config) {
  return (await hashPasscode(code, config.salt, config.iterations)) === config.hash;
}

// ---------- Remembering the phone ----------

export function isUnlocked(now = Date.now()) {
  try {
    return Number(localStorage.getItem(KEY)) > now;
  } catch {
    return false; // storage blocked: ask for the code every time
  }
}

export function rememberUnlock(now = Date.now()) {
  try {
    localStorage.setItem(KEY, String(now + REMEMBER_DAYS * 24 * 60 * 60 * 1000));
  } catch {
    // storage blocked: the code will be asked again next time, nothing else to do
  }
}
