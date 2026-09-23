// Signing in with a magic link (Supabase Auth). No trip data syncs yet — see ROADMAP.md Phase 2.
//
// IMPORTANT: this file is imported (via welcome.js) by app.js on EVERY boot, including fully
// offline boots by an already-signed-in owner. So the Supabase SDK is NEVER imported at the top
// of this file — only inside the functions below, called only when network is actually needed
// (sending a link, completing sign-in). sw.js only caches same-origin requests, so a top-level
// import reaching a CDN would break offline boot.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

let clientPromise; // memoized: Supabase warns against creating more than one GoTrueClient
function getClient() {
  if (!clientPromise) {
    clientPromise = import(SDK_URL).then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        // Kept explicit: the token travels inside the emailed link itself, so the link still
        // works when opened on a different browser/device than the one that asked for it (common:
        // a phone's mail app opening the link in its own in-app browser). "pkce" ties the link to
        // one browser and would silently break that. Do not "helpfully" change this.
        flowType: 'implicit',
        detectSessionInUrl: true,
        persistSession: true,
      },
    })).catch((error) => { clientPromise = undefined; throw error; }); // let a retry try again
  }
  return clientPromise;
}

// Pure string check, no network: true for a magic-link redirect (success: #access_token=...;
// failure: #error=...) or an OAuth/PKCE-style ?code=... redirect. Takes hash/search as plain
// strings (not read from `location` itself) so it can be unit-tested with no DOM mocking.
export function looksLikeAuthCallback(hash, search) {
  if (/(?:^#|[#&])(access_token|error)=/.test(hash ?? '')) return true;
  if (/[?&]code=/.test(search ?? '')) return true;
  return false;
}

// Sends the magic link. Throws a plain-language error on failure (e.g. no internet).
export async function sendMagicLink(email) {
  let supabase;
  try { supabase = await getClient(); }
  catch { throw new Error('Could not reach the sign-in service. Check your connection and try again.'); }
  const redirectTo = location.origin + location.pathname;
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
  if (error) throw new Error('Could not send the sign-in link. Check your connection and try again.');
}

// Call once the page has loaded with a magic-link redirect in the address. Returns {id, email}
// on success; throws a plain-language error otherwise (expired/used link, or none at all).
export async function completeSignIn() {
  let supabase;
  // If the SDK itself could not load (no internet right now), the token in the address is left
  // untouched on purpose: nothing has read it yet, so a later retry (once online) can still use
  // it. Scrubbing it here would throw the token away for good on a simple network hiccup.
  try { supabase = await getClient(); }
  catch { throw new Error('Could not reach the sign-in service. Check your connection and try again.'); }
  const { data: { session } } = await supabase.auth.getSession();
  history.replaceState(null, '', location.pathname); // belt and suspenders: the SDK already clears it on a successful parse
  if (!session) throw new Error('That sign-in link did not work (it may have expired, or already been used). Send yourself a new one.');
  return { id: session.user.id, email: session.user.email };
}

// Best-effort: the local cache (settings.owner) is the real source of truth for this step, so a
// failure here (offline, etc.) is not worth surfacing to the owner.
export async function saveNameToAccount(name) {
  try { (await getClient()).auth.updateUser({ data: { name } }); } catch { /* not critical here */ }
}

// Best-effort and NOT awaited by callers: offline, Supabase's client intentionally leaves the
// local session in place on a network error (so a real offline moment never locks anyone out) —
// that's expected, not a bug. ctx.signOut() in app.js clears the actual local gate (settings.owner).
export async function signOut() {
  try { await (await getClient()).auth.signOut(); } catch { /* local sign-out is what matters offline */ }
}
