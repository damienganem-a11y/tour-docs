// Signing in online from inside the app, for an owner who is already using it (typically one who chose
// "Skip this for now"): email, then the code from the email, no browser hop and no sign-out. The name and
// trips already on the phone stay exactly as they are; only the account behind them is linked, so the
// trips push to it on the next sync. See auth.js's verifyEmailCode for why a code and not a link.

import { h } from '../dom.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { sendMagicLink, verifyEmailCode, cleanEmailCode, saveNameToAccount } from '../auth.js';

export function openOnlineSignIn(ctx) {
  askEmail(ctx, '');
}

function askEmail(ctx, email) {
  const message = h('div', { class: 'message', role: 'alert', hidden: true });
  const input = h('input', {
    class: 'text-input', type: 'email', placeholder: 'Your email', autocomplete: 'email', value: email,
    'aria-label': 'Your email', autocapitalize: 'off', spellcheck: 'false',
  });
  let sending = false;
  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      const address = input.value.trim();
      if (address === '') { input.focus(); return; }
      if (sending) return;
      sending = true;
      try {
        await sendMagicLink(address, ctx.owner.name);
        askCode(ctx, address);
      } catch (error) {
        message.textContent = error.message;
        message.hidden = false;
        sending = false;
      }
    },
  }, input, h('button', { class: 'btn', type: 'submit' }, 'Email me a code'), message);
  openSheet({ eyebrow: 'Sync', title: 'Sign in online', subtitle: 'Your trips and name on this phone stay as they are.', body: form });
}

function askCode(ctx, email) {
  const message = h('div', { class: 'message', role: 'alert', hidden: true });
  const input = h('input', {
    class: 'text-input', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code',
    placeholder: 'Code from the email', 'aria-label': 'Code from the email', maxlength: '12',
  });
  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      if (cleanEmailCode(input.value).length < 6) { input.focus(); return; }
      try {
        const { id } = await verifyEmailCode(email, input.value);
        saveNameToAccount(ctx.owner.name); // fire-and-forget
        closeSheet();
        await ctx.linkOnlineAccount(id);
        showToast('Signed in online');
      } catch (error) {
        message.textContent = error.message;
        message.hidden = false;
      }
    },
  }, input, h('button', { class: 'btn', type: 'submit' }, 'Sign in with the code'), message,
  h('button', { class: 'btn btn--plain', type: 'button', onclick: () => askEmail(ctx, email) }, 'Send a new code'));
  openSheet({
    eyebrow: 'Sync', title: 'Type the code', subtitle: `We emailed a code to ${email}. If the email shows only a link and no code, the email template in Supabase has not been updated yet.`,
    body: form,
  });
}
