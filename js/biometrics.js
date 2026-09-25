// Face ID / Touch ID: an optional, faster way past the access code gate (see gate.js), using the
// phone's own biometric prompt (WebAuthn's "platform authenticator" — Face ID, Touch ID, Windows
// Hello...). Turned on from the Trips screen, one phone at a time.
//
// Like the access code itself, this is device-level convenience, not real security (SPEC.md): there
// is no server to check the result against, so a successful browser/OS biometric prompt is taken at
// its word — the same trust level the access code already has. Real protection comes with phase 2
// accounts.
//
// Once turned on, the app locks itself every time it is reopened (not just after 30 days, like the
// plain access code) — Face ID/Touch ID makes that no burden, and the code is always there as a
// fallback (cold or gloved fingers, a bad reading, Face ID declined).

const CREDENTIAL_KEY = 'tourdocs.biometricCredentialId'; // the one credential this phone registered
const LOCK_KEY = 'tourdocs.biometricLockOn'; // whether the app should lock itself on every reopen

function readCredentialId() {
  try { return localStorage.getItem(CREDENTIAL_KEY); } catch { return null; }
}

export function biometricRegistered() {
  return Boolean(readCredentialId());
}

export function biometricLockOn() {
  try { return biometricRegistered() && localStorage.getItem(LOCK_KEY) === '1'; } catch { return false; }
}

// "abc-_9" (base64url, what a WebAuthn credential's .id already is) -> raw bytes, needed to ask for
// that exact credential again in tryBiometricUnlock.
function base64UrlToBytes(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// Registers this phone's Face ID / Touch ID. Throws (a plain message) if the phone/browser has no
// biometric prompt to offer, or the person cancels it — the Trips screen shows that message as a toast.
export async function enableBiometric() {
  let credential;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)), // only ever checked on THIS phone, never sent anywhere
        rp: { name: 'Tour Docs' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'owner', displayName: 'Tour Docs owner' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000,
      },
    });
  } catch {
    throw new Error('This phone/browser has no Face ID or Touch ID to offer.');
  }
  try {
    localStorage.setItem(CREDENTIAL_KEY, credential.id);
    localStorage.setItem(LOCK_KEY, '1');
  } catch {
    throw new Error('could not save on this phone');
  }
}

export function disableBiometric() {
  try { localStorage.removeItem(CREDENTIAL_KEY); localStorage.removeItem(LOCK_KEY); } catch { /* nothing to clear */ }
}

// Asks for Face ID / Touch ID. true only if it succeeds AND matches the credential this phone
// registered; false on any cancel, failure, or mismatch — the passcode screen always offers typing
// the code instead, so a "no" here is never a dead end.
export async function tryBiometricUnlock() {
  const id = readCredentialId();
  if (!id) return false;
  try {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: base64UrlToBytes(id), type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return credential?.id === id;
  } catch {
    return false;
  }
}
