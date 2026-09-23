// First launch: sign in with a magic link (Phase 2, step 1 — see ROADMAP.md and SPEC.md).
// No trip data syncs yet; this only replaces "type your name" with a real, owner-controlled
// account. Once signed in, the name is written in the journal ("who") and on exports ("Updated
// 14 Jan 14:32, by Damien"), exactly as before.
//
// Flow:
//   1. Enter name + email, "Send me a sign-in link" -> an email arrives with a magic link. The
//      name travels inside that link (see auth.js's sendMagicLink), not in local storage: the
//      phone's mail app often opens the link in a browsing context that does not share storage
//      with the installed app, so anything only saved locally while sending the link can be gone
//      by the time it is clicked.
//   2. Tapping the link brings the phone back here, signed in. A short "Confirm your name" step
//      always follows — pre-filled with the name from step 1 when it made it through the link,
//      blank on the rare occasion it did not (an email service that rewrites/strips links) — so
//      there is always a chance to fix a typo, and never a silent "was that even me?" moment.

import { h } from '../dom.js';
import { pageHead } from './chrome.js';
import { looksLikeAuthCallback, sendMagicLink, completeSignIn, saveNameToAccount } from '../auth.js';

const PENDING_NAME_KEY = 'tourdocs.pendingName'; // best-effort fallback only; the link itself is the real carrier

// Survives a redraw (like the fold flags elsewhere in the app); reset by a full page reload,
// which is exactly what happens after signing in or out.
let step = 'form';      // 'form' | 'callback' | 'confirm-name' | 'sent' | 'error'
let pendingEmail = '';  // shown on "check your email" and on "confirm your name"
let pendingId = null;   // set once completeSignIn() succeeds, used by the "confirm your name" step
let pendingName = '';   // best guess at the name, to pre-fill "confirm your name" (may be blank)
let errorText = '';

export function welcomeView(ctx) {
  if (step === 'form' && looksLikeAuthCallback(location.hash, location.search)) {
    step = 'callback';
    finishCallback(ctx); // async; does not block this render
  }

  if (step === 'callback') return callbackScreen();
  if (step === 'confirm-name') return confirmNameScreen(ctx);
  if (step === 'sent') return sentScreen(ctx);
  return formScreen(ctx); // 'form' and 'error' share the same screen
}

async function finishCallback(ctx) {
  // Read before completeSignIn() runs: it scrubs the address once it has used what it needs.
  let nameFromLink = '';
  try { nameFromLink = new URLSearchParams(location.search).get('name') ?? ''; } catch { /* ignore */ }

  try {
    const { id, email } = await completeSignIn();
    pendingId = id;
    pendingEmail = email;
    pendingName = nameFromLink;
    if (!pendingName) {
      try { pendingName = localStorage.getItem(PENDING_NAME_KEY) ?? ''; } catch { /* storage blocked */ }
    }
    try { localStorage.removeItem(PENDING_NAME_KEY); } catch { /* storage blocked */ }
    step = 'confirm-name';
  } catch (error) {
    step = 'error';
    errorText = error.message;
  }
  ctx.refresh();
}

function callbackScreen() {
  return {
    node: h('div', { class: 'screen' },
      pageHead({ eyebrow: 'Tour Docs', title: 'Signing you in…' })),
  };
}

// Always shown once signed in: a chance to keep or fix the name, never a silent step and never a
// blank re-ask when it is already known (see finishCallback).
function confirmNameScreen(ctx) {
  const input = h('input', {
    class: 'text-input', type: 'text', placeholder: 'Your name', autocomplete: 'given-name',
    'aria-label': 'Your name', maxlength: '60', value: pendingName,
  });

  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (name === '') { input.focus(); return; }
      saveNameToAccount(name); // fire-and-forget
      await ctx.saveOwner(name, pendingId); // navigates to the Trips screen; welcome.js is not shown again
    },
  }, input, h('button', { class: 'btn', type: 'submit' }, pendingName ? 'Continue' : 'Save'));

  return {
    node: h('div', { class: 'screen' },
      pageHead({ eyebrow: 'Tour Docs', title: 'Welcome', subtitle: `Signed in as ${pendingEmail}` }),
      h('p', { class: 'muted' }, 'This is your name in the journal and on the lists you export, so everyone knows who changed what. Keep it, or change it below.'),
      form),
  };
}

// True when running as an app icon added to the home screen, not a plain browser tab (the
// non-standard `navigator.standalone` is Apple's own iOS Safari flag; other platforms report it
// through the standard `display-mode` media feature).
const isStandalone = () => navigator.standalone === true || (window.matchMedia?.('(display-mode: standalone)').matches ?? false);

function sentScreen(ctx) {
  return {
    node: h('div', { class: 'screen' },
      pageHead({ eyebrow: 'Tour Docs', title: 'Check your email', subtitle: `We sent a sign-in link to ${pendingEmail}.` }),
      h('p', { class: 'muted' }, 'Open it on this phone to continue. It can take a minute to arrive.'),
      // Tapping the link from Mail often opens Safari instead of the installed app icon on the
      // iPhone (a quirk of "Add to Home Screen" apps, not something the app can avoid). Warning
      // about it here, right before they go tap it, turns a confusing moment into an expected one.
      isStandalone()
        ? h('p', { class: 'notice' }, 'On iPhone, the link may open in Safari instead of this app icon — that is normal. Once it says you are signed in there, close this app fully (swipe it away) and reopen it from its icon.')
        : null,
      h('button', {
        class: 'btn btn--plain', type: 'button',
        onclick: () => { step = 'form'; ctx.refresh(); },
      }, 'Use a different email')),
  };
}

function formScreen(ctx) {
  const message = h('div', { class: 'message', role: 'alert', hidden: step !== 'error' });
  if (step === 'error') message.textContent = errorText;

  const nameInput = h('input', {
    class: 'text-input', type: 'text', placeholder: 'Your name', autocomplete: 'given-name',
    'aria-label': 'Your name', maxlength: '60', value: pendingName,
  });
  const emailInput = h('input', {
    class: 'text-input', type: 'email', placeholder: 'Your email', autocomplete: 'email', value: pendingEmail,
    'aria-label': 'Your email', autocapitalize: 'off', spellcheck: 'false',
  });
  let sending = false; // ignore a second tap while the first is being sent

  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      if (name === '') { nameInput.focus(); return; }
      if (email === '') { emailInput.focus(); return; }
      if (sending) return;
      sending = true;
      pendingName = name;   // kept for a retry after an error, whether or not this attempt succeeds
      pendingEmail = email;
      try { localStorage.setItem(PENDING_NAME_KEY, name); } catch { /* storage blocked: the name travels in the link itself anyway */ }
      try {
        await sendMagicLink(email, name);
        step = 'sent';
      } catch (error) {
        step = 'error';
        errorText = error.message;
      }
      sending = false;
      ctx.refresh();
    },
  }, nameInput, emailInput, h('button', { class: 'btn', type: 'submit' }, 'Send me a sign-in link'), message);

  return {
    node: h('div', { class: 'screen' },
      pageHead({ eyebrow: 'Tour Docs', title: 'Welcome', subtitle: 'Sign in to get started' }),
      h('p', { class: 'muted' }, 'We email you a link: no password to remember. Your name goes in the journal and on the lists you export, so everyone knows who changed what.'),
      form),
  };
}
