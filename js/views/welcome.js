// First launch only: ask for the owner's name.
// It is written in the journal ("who") and on exports ("Updated 14 Jan 14:32, by Damien").

import { h } from '../dom.js';
import { pageHead } from './chrome.js';

export function welcomeView(ctx) {
  const input = h('input', {
    class: 'text-input', type: 'text', placeholder: 'Your name', autocomplete: 'given-name',
    'aria-label': 'Your name', maxlength: '60',
  });

  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (name === '') { input.focus(); return; }
      await ctx.saveOwner(name);
    },
  },
    input,
    h('button', { class: 'btn', type: 'submit' }, 'Continue')
  );

  return {
    node: h('div', { class: 'screen' },
      pageHead({ eyebrow: 'Tour Docs', title: 'Welcome', subtitle: 'What should we call you?' }),
      h('p', { class: 'muted' }, 'Your name goes in the journal and on the lists you export, so everyone knows who changed what.'),
      form
    ),
  };
}
