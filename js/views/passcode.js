// The access code screen. Shown before anything else when the online version is locked (see gate.js
// and, when Face ID/Touch ID is turned on in Trips, biometrics.js).

import { h } from '../dom.js';
import { pageHead } from './chrome.js';

export function passcodeView(ctx) {
  const message = h('div', { class: 'message', role: 'alert', hidden: true });
  const input = h('input', {
    class: 'text-input', type: 'password', placeholder: 'Access code', 'aria-label': 'Access code',
    autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
  });
  let checking = false; // ignore a second attempt (Face ID or the code) while one is already in flight

  function fail(text) {
    message.textContent = text;
    message.hidden = false;
  }

  async function submitCode(event) {
    event.preventDefault();
    if (checking || input.value.trim() === '') { input.focus(); return; }
    checking = true;
    const ok = await ctx.tryUnlock(input.value);
    checking = false;
    if (!ok) { fail('That code is not right. Try again.'); input.value = ''; input.focus(); }
  }

  const form = h('form', { onsubmit: submitCode }, input, h('button', { class: 'btn', type: 'submit' }, 'Unlock'));

  if (!ctx.biometricOn) {
    return {
      node: h('div', { class: 'screen' },
        pageHead({ eyebrow: 'Tour Docs', title: 'Access code', subtitle: 'Enter the code to open the app.' }),
        form, message),
    };
  }

  // Face ID / Touch ID is turned on (Trips screen): offer it first, with the code always available
  // right below as a fallback (a cold or gloved finger, a bad reading, Face ID declined...).
  async function tryFaceId() {
    if (checking) return;
    checking = true;
    const ok = await ctx.unlockWithBiometric();
    checking = false;
    if (!ok) fail('Face ID / Touch ID did not work. Enter the access code below instead.');
  }
  requestAnimationFrame(tryFaceId); // most people expect the prompt to pop up on its own, not to tap first

  return {
    node: h('div', { class: 'screen' },
      pageHead({ eyebrow: 'Tour Docs', title: 'Access code', subtitle: 'Unlock with Face ID / Touch ID, or the code below.' }),
      h('button', { class: 'btn', type: 'button', onclick: tryFaceId }, 'Unlock with Face ID / Touch ID'),
      message,
      form),
  };
}
