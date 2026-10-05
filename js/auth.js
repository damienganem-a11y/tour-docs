// Signing in with a magic link (Supabase Auth). No trip data syncs yet — see ROADMAP.md Phase 2.
//
// IMPORTANT: this file is imported (via welcome.js) by app.js on EVERY boot, including fully
// offline boots by an already-signed-in owner. So the Supabase SDK is NEVER imported at the top
// of this file — only inside the functions below, called only when network is actually needed
// (sending a link, completing sign-in). sw.js only caches same-origin requests, so a top-level
// import reaching a CDN would break offline boot.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Exported so sync.js (Phase 2, step 2) reuses this exact same memoized client, instead of a
// second independent one — Supabase warns against creating more than one GoTrueClient, since
// competing instances can race each other refreshing the same session token.
let clientPromise;
export function getClient() {
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

// A QR code made by the trip's owner (Settings > Team) holds a one-time token instead of asking for an e-mail: ?th=<token>&t=m|i&name=...
// Pure string check, like looksLikeAuthCallback. t: m = magic link, i = invite (a person who never signed in before).
export function teamLinkFromAddress(search) {
  const params = new URLSearchParams(search ?? '');
  const token = (params.get('th') ?? '').trim();
  if (!/^[A-Za-z0-9_-]{20,120}$/.test(token)) return null;
  return { tokenHash: token, type: params.get('t') === 'i' ? 'invite' : 'magiclink', name: (params.get('name') ?? '').trim().slice(0, 60) };
}

// Swaps the token of such a QR code for a session. Returns { id, email }; throws a plain sentence when it fails (used already, or too old).
export async function signInWithTeamLink(link) {
  let supabase;
  try { supabase = await getClient(); }
  catch { throw new Error('Could not reach the sign-in service. Check your connection and try again.'); }
  let result = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
  if (result.error && link.type === 'magiclink') result = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: 'email' });
  history.replaceState(null, '', location.pathname);
  const session = result.data?.session;
  if (result.error || !session) throw new Error('This QR code did not work: it can only be used once, and only for about an hour. Ask for a new one.');
  return { id: session.user.id, email: session.user.email };
}

// Sends the magic link. The name travels inside the link itself (as a query parameter, next to
// the token Supabase adds), not in localStorage: the phone's mail app often opens the link in a
// browsing context that does not share storage with the installed app, so anything saved locally
// while sending the link can be gone by the time it is clicked. The name is not sensitive (it is
// about to be shown on screen anyway), so this is a fine place for it.
// Throws a plain-language error on failure — the REAL reason from Supabase when it answered at
// all (for example a rate limit after several tries), or a connection message when it could not
// even be reached.
export async function sendMagicLink(email, name) {
  let supabase;
  try { supabase = await getClient(); }
  catch { throw new Error('Could not reach the sign-in service. Check your connection and try again.'); }
  const redirectTo = `${location.origin}${location.pathname}?name=${encodeURIComponent(name)}`;
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
  if (error) throw new Error(error.message);
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

// A session may already exist in THIS browsing context even with no callback URL to process — most
// often because Safari and an installed Home Screen icon do not reliably share storage on iPhone (a
// known platform quirk, not a bug here): the magic link opens in Safari (that is simply where Mail
// sends it), sign-in completes there, and the icon, opened separately later, never sees that URL at
// all. Checked once by welcome.js whenever it is about to show the sign-in form again, so a
// mismatched icon can recover on its own — the app was already signed in, it just did not know it —
// instead of asking to send another link. Never throws: "no session yet" is the ordinary case for a
// brand new sign-in, not a failure to report.
export async function existingSession() {
  let supabase;
  try { supabase = await getClient(); } catch { return null; }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.user_metadata?.name ?? '' };
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

// ---------- Signing in with the CODE from the email (added 30 Sep 2026) ----------
// The same email that carries the magic link can also carry a short code (the Supabase email template
// must include {{ .Token }}). Typing the code inside the app needs no browser hop, which is the whole
// point on iPhone: the emailed link always opens Safari, and Safari and the Home Screen icon may not
// share the login (see existingSession above). Verifying the code stores the login in THIS browsing
// context, wherever the app is running.

// Keeps only the digits, so a code pasted with spaces or dashes ("123 456") still works.
export function cleanEmailCode(text) {
  return String(text ?? '').replace(/\D/g, '');
}

// Returns {id, email}; throws a plain-language error otherwise.
export async function verifyEmailCode(email, code) {
  let supabase;
  try { supabase = await getClient(); }
  catch { throw new Error('Could not reach the sign-in service. Check your connection and try again.'); }
  const { data, error } = await supabase.auth.verifyOtp({ email, token: cleanEmailCode(code), type: 'email' });
  if (error) throw new Error(/expired|invalid/i.test(error.message) ? 'That code did not work (wrong, or expired). Check it, or send a new one.' : error.message);
  const user = data?.session?.user ?? data?.user;
  if (!user) throw new Error('That code did not work. Send a new one.');
  return { id: user.id, email: user.email };
}

// true / false = this browser does / does not hold a live online login. null = cannot tell right now
// (no internet to load the sign-in service), so callers must not claim either.
export async function hasLiveSession() {
  let supabase;
  try { supabase = await getClient(); } catch { return null; }
  try { const { data: { session } } = await supabase.auth.getSession(); return Boolean(session); } catch { return null; }
}
