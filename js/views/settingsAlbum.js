// Settings > Our Album (v0.128.0): the guests' photo circle, seen from the staff side.
//   - Owner: switch the album on or off, choose how long guests can download after the trip, see who has saved everything, remind those who have not.
//   - Owner and team (not viewers): add photos, mark favourites (shown first to guests), delete a photo.
// The photos are on the server (supabase/functions/album); this screen asks for links that expire in an hour. The settings are a trip setting, so they go through
// the one change function (changes.js) and are in the Journal. The photos themselves are NOT in the Journal.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { displayNames, alphabetical, plural } from '../rules.js';
import { pageHead } from './chrome.js';
import { notice } from './move.js';
import { albumSettings, albumPhase, downloadProgress } from '../album.js';
import { shrinkPhoto } from '../albumImage.js';

const niceDate = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }) : 'not set');
const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
const DOWNLOAD_CHOICES = [30, 60, 90, 180];

// The photo picker: ONE hidden file field kept on the page's body (not inside a screen), and the sending runs from here, with its progress shown as toasts.
// A toast stays on screen even if the screen behind it is redrawn.
let picker = null;
let pickerFor = null;      // { ctx, trip } of the page that opened the picker last
let sending = false;
function pickPhotos(ctx, trip) {
  pickerFor = { ctx, trip };
  if (!picker) {
    picker = h('input', { type: 'file', accept: 'image/*', multiple: '', class: 'file-hidden', 'aria-hidden': 'true', tabindex: '-1' });
    picker.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';
    picker.addEventListener('change', () => { const files = [...picker.files]; picker.value = ''; if (files.length) uploadFiles(files); });
    document.body.append(picker);
  }
  picker.click();
}
async function uploadFiles(files) {
  if (sending || !pickerFor) return;
  const { ctx, trip } = pickerFor;
  sending = true;
  let sent = 0; let problem = null;
  for (const [i, file] of files.entries()) {
    showToast(`Sending photo ${i + 1} of ${files.length}…`);
    try {
      const full = await shrinkPhoto(file, 2000, 0.82); const thumb = await shrinkPhoto(file, 420, 0.7);
      const r = await ctx.album.upload(trip.id, ctx.userFor(trip.id).name ?? 'Staff', { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height });
      if (r.ok) sent++;
      else { problem = r.error === 'closed' ? 'The album is closed for new photos.' : r.error === 'off' ? 'The album is switched off, or its dates are not saved on the server yet. Open the app online as the owner and try again.' : r.error === 'link' ? 'You are not signed in online: sign in, then try again.' : `The server refused a photo (${r.error ?? 'unknown'}).`; break; }
    } catch (e) { problem = `A photo could not be sent: ${String(e?.message ?? e).slice(0, 120)}`; break; }
  }
  sending = false;
  if (problem) showToast(sent ? `${plural(sent, 'photo')} added. ${problem}` : problem, true);
  else showToast(`${plural(sent, 'photo')} added`);
  if (sent) ctx.refresh();
}

export function albumSettingsPage(ctx, trip) {
  const owner = ctx.roleFor(trip.id) === 'owner';
  const settings = albumSettings(trip);
  const head = pageHead({ back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' }, eyebrow: 'Our Album', title: 'Our Album', subtitle: 'A photo circle: guests and staff add photos, everyone on the trip can save them.' });
  const content = h('div', {});
  const root = h('div', {}, head, content);
  let data = null;
  let links = {};

  async function run(change, message) {
    const result = await applyChange(ctx, trip.id, change);
    if (result.ok) { ctx.refresh(); showToast(message); } else showToast(result.error, true);
  }

  async function load() {
    try {
      data = await ctx.album.pull(trip.id);
      links = await ctx.album.links(trip.id, data.photos.slice(0, 300).map((p) => p.id), 'thumb').catch(() => ({}));
    } catch { data = { error: true }; }
    draw();
  }

  function photoSheet(photo) {
    const img = h('img', { class: 'album-big', alt: '', src: links[photo.id] ?? '' });
    ctx.album.links(trip.id, [photo.id], 'full').then((u) => { if (u[photo.id]) img.src = u[photo.id]; }).catch(() => {});
    const by = photo.guest_id ? (displayNames(trip.guests).get(photo.guest_id) ?? 'A guest') : (photo.author_name || 'Staff');
    openSheet({
      eyebrow: 'Photo', title: by, subtitle: new Date(photo.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }),
      body: [img,
        h('button', { class: 'btn', type: 'button', onclick: async () => { await ctx.album.act(trip.id, 'pin', photo.id, { pinned: !photo.pinned }); closeSheet(); load(); showToast(photo.pinned ? 'No longer a favourite' : 'Marked as a favourite: guests see it first'); } }, photo.pinned ? 'Remove from favourites' : '★ Make a favourite'),
        h('button', { class: 'btn btn--plain', type: 'button', onclick: async () => { if (!confirm('Delete this photo for everyone? This cannot be undone.')) return; await ctx.album.act(trip.id, 'delete', photo.id); closeSheet(); load(); showToast('Photo deleted'); } }, 'Delete this photo')],
      cancelLabel: 'Close',
    });
  }

  function draw() {
    const phase = albumPhase(settings, todayIso());
    const blocks = [];
    // Dates and switch
    blocks.push(h('div', { class: 'card' },
      h('div', { class: 'act-name' }, settings.enabled ? 'Our Album is on' : 'Our Album is off'),
      h('div', { class: 'muted' }, settings.enabled
        ? `Guests can add photos until ${niceDate(settings.uploadUntil)} (one week after the trip). They can download until ${niceDate(settings.downloadUntil)}, then every photo is erased from the server.`
        : 'Guests do not see the album.'),
      settings.enabled && settings.downloadUntil ? h('div', { class: 'muted' }, 'Do not archive the trip before then: archiving switches the guests\' links off, and with them the album.') : null,
      owner ? h('div', { class: 'card-actions' },
        h('button', { class: 'btn btn--small', type: 'button', onclick: () => run({ type: 'guest-links', action: 'album-settings', settings: { enabled: !settings.enabled } }, settings.enabled ? 'Our Album is off' : 'Our Album is on') }, settings.enabled ? 'Switch off' : 'Switch on'),
        settings.enabled ? h('select', { class: 'text-input', 'aria-label': 'Days guests can download after the trip', onchange: (e) => run({ type: 'guest-links', action: 'album-settings', settings: { downloadDays: Number(e.target.value) } }, 'Saved') },
          [...new Set([...DOWNLOAD_CHOICES, settings.downloadDays])].sort((a, b) => a - b).map((n) => h('option', { value: String(n), selected: n === settings.downloadDays ? '' : null }, `Download for ${n} days`))) : null) : null));

    if (!settings.enabled) { content.replaceChildren(...blocks); return; }
    if (!data) { content.replaceChildren(...blocks, h('p', { class: 'muted' }, 'Loading the photos…')); return; }
    if (data.error) { content.replaceChildren(...blocks, h('p', { class: 'muted' }, 'The photos could not be loaded. The database may not be updated yet (Settings > Check this phone), or you are offline.'), h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: load }, 'Try again')); return; }
    if (!data.settings) blocks.push(notice('The album is not yet saved on the server. It is saved by the owner\'s phone when the app is open and online.'));

    // Add photos (staff). The file picker lives outside this page (see uploadFiles): the app redraws its screens by itself, and a redraw while the phone's
    // photo picker is open used to throw away the page that was waiting for the answer, so nothing happened after "Add".
    if (ctx.roleFor(trip.id) !== 'viewer' && phase !== 'over') blocks.push(h('div', {}, h('button', { class: 'btn', type: 'button', onclick: () => pickPhotos(ctx, trip) }, 'Add photos as staff')));

    // The grid
    const photos = data.photos;
    const pinned = photos.filter((p) => p.pinned);
    const tile = (p) => h('button', { class: 'album-tile', type: 'button', 'aria-label': 'Photo', onclick: () => photoSheet(p) },
      links[p.id] ? h('img', { src: links[p.id], alt: '', loading: 'lazy' }) : h('span', { class: 'album-wait' }), p.pinned ? h('i', { class: 'album-pin' }, '★') : null);
    blocks.push(h('h2', { class: 'section-title' }, `Photos (${photos.length})`),
      photos.length === 0 ? h('p', { class: 'empty' }, 'No photo yet.') : null,
      pinned.length ? h('div', {}, h('div', { class: 'muted' }, 'Favourites'), h('div', { class: 'album-grid' }, pinned.map(tile))) : null,
      photos.length ? h('div', { class: 'album-grid' }, photos.map(tile)) : null);

    // Who has saved everything (owner)
    if (owner && photos.length) {
      const names = displayNames(trip.guests);
      const guests = trip.guests.filter((g) => !g.leftAt).sort(alphabetical(names));
      const progress = downloadProgress(photos, data.marks, guests.map((g) => g.id));
      const missing = progress.filter((p) => !p.complete);
      blocks.push(h('h2', { class: 'section-title' }, 'Who has saved the photos'),
        h('p', { class: 'muted' }, missing.length === 0 ? 'Everybody has saved every photo.' : `${plural(progress.length - missing.length, 'guest')} of ${progress.length} saved everything. A photo a guest skipped counts as done.`),
        ...progress.map((p) => h('div', { class: 'card card--soft' }, h('div', { class: 'act-name' }, names.get(p.guestId)), h('div', { class: 'muted' }, p.complete ? 'Saved everything' : `${p.done} of ${p.total} saved, ${p.missing} to go`))),
        missing.length ? h('button', { class: 'btn', type: 'button', onclick: async () => {
          try {
            const r = await ctx.notifyGuestList(trip.id, missing.map((m) => m.guestId), 'Our Album: photos waiting for you', `New photos are waiting. Open Our Album and tap "Download new"${settings.downloadUntil ? ` before ${niceDate(settings.downloadUntil)}` : ''}.`);
            showToast(`Reminder sent to ${r?.sent ?? 0} phone${r?.sent === 1 ? '' : 's'}`);
          } catch { showToast('The reminder could not be sent (is the notification setup done?).', true); }
        } }, `Remind the ${missing.length} who have not saved everything`) : null,
        h('p', { class: 'muted' }, 'Guests also get automatic reminders: one week before the album closes, the day after, and two weeks before the photos are erased (only guests who turned notifications on).'));
    }
    content.replaceChildren(...blocks);
  }

  draw();
  if (settings.enabled) load();
  return root;
}
