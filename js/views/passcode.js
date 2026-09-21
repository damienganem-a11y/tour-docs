// The access code screen. Shown before anything else when the online version is locked.

import { h } from '../dom.js';
import { pageHead } from './chrome.js';

export function passcodeView(ctx) {
  const message = h('div', { class: 'message', role: 'alert', hidden: true });
  const input = h('input', {
    class: 'text-input', type: 'password', placeholder: 'Access code', 'aria-label': 'Access code',
    autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
  });
  let checking = false; // ignore a second tap while the first is being checked

  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      if (checking || input.value.trim() === '') { input.focus(); return; }
      checking = true;
      const ok = await ctx.tryUnlock(input.value);
      checking = false;
      if (!ok) {
        message.textContent = 'That code is not right. Try again.';
        message.hidden = false;
        input.value = '';
        input.focus();
      }
    },
  },
    input,
    h('button', { class: 'btn', type: 'submit' }, 'Unlock'),
    message
  );

  return {
    node: h('div', { class: 'screen' },
      pageHead({ eyebrow: 'Tour Docs', title: 'Access code', subtitle: 'Enter the code to open the app.' }),
      form),
  };
}
