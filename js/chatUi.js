// The chat window, shared by the staff app and the guest app (v0.133.0): a full-screen conversation like WhatsApp. Messages in bubbles (yours on the right, the
// other side's on the left), a label for each day, the time in each bubble, two ticks when the other side has read it, and a writing box at the bottom that
// stays above the keyboard. It builds its own elements and imports only chat.js, so both apps can use it.
//
// openChat({ title, subtitle, name, getMessages(), isMine(m), labelOf(m), onSend(text) -> Promise<{ ok, error? }>, onClose, menu, refresh, refreshEvery, placeholder, maxLength, note })
//   getMessages(): the messages now (called again at each redraw).   labelOf(m): the small name above a bubble ('' for none).
//   menu: [{ label, onClick }] under the "⋯" button.   refresh(): called every refreshEvery ms while open, to fetch new messages; it returns nothing, and the
//   caller then calls the returned redraw() (or the window redraws itself after it).
// Returns { redraw, close }.

import { groupByDay, clockOf, initialsOf, hueOf } from './chat.js';

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value; else if (key === 'style') node.style.cssText = value; else if (key.startsWith('on')) node.addEventListener(key.slice(2), value); else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
  return node;
}

// The round picture with initials, in a colour of its own.
export function avatar(name, size = 40) {
  return el('span', { class: 'chat-avatar', style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;background:hsl(${hueOf(name)} 45% 40%)`, 'aria-hidden': 'true' }, initialsOf(name));
}

export function openChat(options) {
  document.querySelector('.chat')?.remove();
  const scroll = el('div', { class: 'chat-scroll' });
  const input = el('textarea', { class: 'chat-input', rows: '1', maxlength: String(options.maxLength ?? 1000), placeholder: options.placeholder ?? 'Message', 'aria-label': 'Your message', enterkeyhint: 'send' });
  const send = el('button', { class: 'chat-send', type: 'button', 'aria-label': 'Send' }, '➤');
  const error = el('div', { class: 'chat-error', role: 'alert', hidden: '' });
  const menuBox = el('div', { class: 'chat-menu', hidden: '' });
  const back = el('button', { class: 'chat-back', type: 'button', 'aria-label': 'Back', onclick: () => close() }, '‹');
  const header = el('div', { class: 'chat-head' }, back, avatar(options.name ?? options.title, 38),
    el('div', { class: 'chat-who' }, el('b', {}, options.title), options.subtitle ? el('small', {}, options.subtitle) : null),
    options.menu?.length ? el('button', { class: 'chat-more', type: 'button', 'aria-label': 'More', onclick: () => { menuBox.hidden = !menuBox.hidden; } }, '⋯') : null);
  const root = el('div', { class: 'chat', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Conversation with ${options.title}` },
    header, menuBox, scroll, options.note ? el('div', { class: 'chat-note' }, options.note) : null, error, el('div', { class: 'chat-compose' }, input, send));
  for (const item of options.menu ?? []) menuBox.append(el('button', { type: 'button', onclick: async () => { menuBox.hidden = true; await item.onClick(); } }, item.label));

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.body.append(root);

  // The window follows the part of the screen the keyboard leaves free.
  const fit = () => { const v = window.visualViewport; root.style.height = `${v?.height ?? window.innerHeight}px`; root.style.top = `${v?.offsetTop ?? 0}px`; };
  fit();
  window.visualViewport?.addEventListener('resize', fit); window.visualViewport?.addEventListener('scroll', fit);

  let lastKey = '';
  function redraw({ force = false } = {}) {
    const messages = options.getMessages();
    const key = JSON.stringify(messages.map((m) => [m.id, m.read_at]));
    if (key === lastKey && !force) return;
    lastKey = key;
    const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 120;
    const nodes = [];
    if (messages.length === 0) nodes.push(el('p', { class: 'chat-empty' }, options.emptyText ?? 'No message yet.'));
    for (const day of groupByDay(messages)) {
      nodes.push(el('div', { class: 'chat-day' }, el('span', {}, day.label)));
      for (const m of day.messages) {
        const mine = options.isMine(m);
        const label = options.labelOf?.(m) ?? '';
        nodes.push(el('div', { class: `chat-bubble ${mine ? 'is-mine' : 'is-theirs'}` },
          label ? el('div', { class: 'chat-label' }, label) : null,
          el('div', { class: 'chat-text' }, m.body),
          el('div', { class: 'chat-time' }, clockOf(m.created_at), mine ? el('span', { class: `chat-ticks${m.read_at ? ' is-read' : ''}`, 'aria-label': m.read_at ? 'Read' : 'Sent' }, m.read_at ? '✓✓' : '✓') : null)));
      }
    }
    scroll.replaceChildren(...nodes);
    if (nearBottom || force) scroll.scrollTop = scroll.scrollHeight;
  }

  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; };
  input.addEventListener('input', grow);
  let sending = false;
  async function submit() {
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true; send.disabled = true; error.hidden = true;
    let result;
    try { result = await options.onSend(text); } catch { result = { ok: false, error: 'The message could not be sent. Check your connection and try again.' }; }
    sending = false; send.disabled = false;
    if (result?.ok) { input.value = ''; grow(); redraw({ force: true }); input.focus(); }
    else { error.hidden = false; error.textContent = result?.error ?? 'The message could not be sent.'; }
  }
  send.addEventListener('click', submit);
  // On a computer Enter sends (Shift+Enter makes a new line); on a phone Enter makes a new line and the arrow sends.
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); submit(); } });

  let timer = null;
  if (options.refresh) timer = setInterval(async () => { try { await options.refresh(); redraw(); } catch { /* offline: the next round tries again */ } }, options.refreshEvery ?? 5000);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  function close() {
    clearInterval(timer);
    document.removeEventListener('keydown', onKey);
    window.visualViewport?.removeEventListener('resize', fit); window.visualViewport?.removeEventListener('scroll', fit);
    document.body.style.overflow = previousOverflow;
    root.remove();
    options.onClose?.();
  }
  redraw({ force: true });
  return { redraw, close };
}
