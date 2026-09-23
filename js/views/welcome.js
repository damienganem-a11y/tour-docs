// First launch: sign in with a magic link (Phase 2, step 1 — see ROADMAP.md and SPEC.md).
// No trip data syncs yet; this only replaces "type your name" with a real, owner-controlled
// account. Once signed in, the name is written in the journal ("who") and on exports ("Updated
// 14 Jan 14:32, by Damien"), exactly as before.
//
// Flow:
//   1. Enter name + email, "Send me a sign-in link" -> an email arrives with a magic link.
//   2. Tapping the link in the email brings the phone back here with a token in the address.
//      Usually that is the SAME phone that asked for the link, so the name typed in step 1
//      (kept in localStorage while waiting) is already known and sign-in finishes right away.
//   3. If the link is opened somewhere else (a different device, or the name was lost), a short
//      "What should we call you?" step asks for it instead of failing silently.

import { h } from '../dom.js';
import { pageHead } from './chrome.js';
import { looksLikeAuthCallback, sendMagicLink, completeSignIn, saveNameToAccount } from '../auth.js';

const PENDING_NAME_KEY = 'tourdocs.pendingName';

// Survives a redraw (like the fold flags elsewhere in the app); reset by a full page reload,
// which is exactly what happens after signing in or out.
let step = 'form';      // 'form' | 'callback' | 'need-name' | 'sent' | 'error'
let pendingEmail = '';  // shown on "check your email" and, after a cross-device callback, "what's your name"
let pendingId = null;   // set once completeSignIn() succeeds but no pending name was found locally
let errorText = '';

export function welcomeView(ctx) {
  if (step === 'form' && looksLikeAuthCallback(location.hash, location.search)) {
    step = 'callback';
    finishCallback(ctx); // async; does not block this render
  }

  if (step === 'callback') return callbackScreen();
  if (step === 'need-name') return nameScreen(ctx);
  if (step === 'sent') return sentScreen(ctx);
  return formScreen(ctx); // 'form' and 'error' share the same screen
}

async function finishCallback(ctx) {
  try {
    const { id, email } = await completeSignIn();
    let name = '';
    try { name = localStorage.getItem(PENDING_NAME_KEY) ?? ''; } catch { /* storage blocked */ }
    if (name) {
      try { localStorage.removeItem(PENDING_NAME_KEY); } catch { /* storage blocked */ }
      saveNameToAccount(name); // fire-and-forget: the local cache below is what actually matters here
      await ctx.saveOwner(name, id); // navigates to the Trips screen; welcome.js is not shown again
      return;
    }
    pendingId = id;
    pendingEmail = email;
    step = 'need-name';
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

// The email is known (from the sign-in link itself), but not a name: this device never asked for
// the link, or lost track of what was typed. One short question closes the gap.
function nameScreen(ctx) {
  const input = h('input', {
    class: 'text-input', type: 'text', placeholder: 'Your name', autocomplete: 'given-name',
    'aria-label': 'Your name', maxlength: '60',
  });

  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (name === '') { input.focus(); return; }
      saveNameToAccount(name); // fire-and-forget
      await ctx.saveOwner(name, pendingId);
    },
  }, input, h('button', { class: 'btn', type: 'submit' }, 'Continue'));

  return {
    node: h('div', { class: 'screen' },
      pageHead({ eyebrow: 'Tour Docs', title: 'Welcome', subtitle: `Signed in as ${pendingEmail}. What should we call you?` }),
      h('p', { class: 'muted' }, 'Your name goes in the journal and on the lists you export, so everyone knows who changed what.'),
      form),
  };
}

function sentScreen(ctx) {
  return {
    node: h('div', { class: 'screen' },
      pageHead({ eyebrow: 'Tour Docs', title: 'Check your email', subtitle: `We sent a sign-in link to ${pendingEmail}.` }),
      h('p', { class: 'muted' }, 'Open it on this phone to continue. It can take a minute to arrive.'),
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
    'aria-label': 'Your name', maxlength: '60',
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
      try { localStorage.setItem(PENDING_NAME_KEY, name); } catch { /* storage blocked: the name-screen fallback still works */ }
      try {
        await sendMagicLink(email);
        pendingEmail = email;
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
