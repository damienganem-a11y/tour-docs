// Settings > Backup (SPEC.md, "2. Settings"): export the whole trip and its whole journal as one
// JSON file, or restore one back onto the phone. Unlike every other export this one DOES include
// dietary info (the owner's own decision, 21 Sep 2026), so the file is sensitive: never share it
// anywhere but straight to yourself (Files, AirDrop, email to yourself), never online, never in Git.

import { h } from '../dom.js';
import { pageHead } from './chrome.js';
import { buildBackup, parseBackup, backupFileName } from '../backup.js';
import { shareOrDownloadFile, showToast } from '../ui.js';

export function backupSettingsPage(ctx, trip) {
  const message = h('div', { class: 'message', role: 'alert', hidden: true });
  const showError = (text) => { message.textContent = text; message.hidden = false; };

  let busy = false;
  const exportButton = h('button', {
    class: 'btn', type: 'button',
    onclick: async () => {
      if (busy) return;
      busy = true;
      const blob = buildBackup(trip, ctx.journal(trip.id));
      await shareOrDownloadFile(blob, backupFileName(trip), 'application/json');
      busy = false;
    },
  }, `Export backup of "${trip.name}"`);

  const fileInput = h('input', {
    class: 'file-input', type: 'file', accept: '.json,application/json',
    onchange: async () => {
      const file = fileInput.files[0];
      fileInput.value = ''; // so choosing the same file again still works
      if (!file) return;
      message.hidden = true;
      let restored;
      try {
        restored = parseBackup(await file.text());
      } catch (error) {
        showError(error instanceof SyntaxError ? 'This file is not valid JSON.' : error.message);
        return;
      }
      try {
        await ctx.restoreBackup(restored.trip, restored.journal);
      } catch (error) {
        showError(`Could not save the restored trip on this phone (${error.message}).`);
        return;
      }
      showToast(`Restored "${restored.trip.name}".`);
      ctx.go(`#/trip/${restored.trip.id}/settings`);
    },
  });
  const importButton = h('button', { class: 'btn btn--plain', type: 'button', onclick: () => fileInput.click() }, 'Restore a backup file');

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
      eyebrow: 'Backup',
      title: 'Backup',
      subtitle: 'A backup includes dietary info, so keep the file to yourself — never share it online.',
    }),
    exportButton,
    importButton,
    fileInput,
    message,
    h('p', { class: 'muted count-line' },
      'Restoring loads the trip that is inside the backup file (with its whole journal, so Undo history is not lost) — it may be a different trip than the one you have open now.'));
}
