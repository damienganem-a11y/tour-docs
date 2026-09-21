// Tiny helper for building screen elements.
//
//   h('div', { class: 'card' }, h('h2', {}, 'Hello'), 'some text')
//
// builds:  <div class="card"><h2>Hello</h2>some text</div>
//
// Text is always added as plain text (never as HTML), so a name like  O'Connell  or  <b>
// can never break the page.

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value); // onclick -> "click"
    else node.setAttribute(key, value === true ? '' : value);
  }

  // A child may be a list of children (or a list of lists): unwrap them all the way down.
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child); // a string becomes text, an element is inserted as is
  }
  return node;
}

// Makes a button understand both a tap and a long press (finger held down for about half a second).
//   pressable(button, { tap, long })
// A long press does NOT also count as a tap. Scrolling with the finger cancels the press.
// The iPhone's own long-press menu is switched off for this button (see "user-select" in styles.css).
export function pressable(node, { tap, long, ms = 500 }) {
  let timer = null;
  let longFired = false;

  node.addEventListener('pointerdown', () => {
    longFired = false;
    clearTimeout(timer);
    timer = setTimeout(() => { longFired = true; long(); }, ms);
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
    node.addEventListener(type, () => clearTimeout(timer));
  }
  node.addEventListener('click', (event) => {
    if (longFired) { longFired = false; event.preventDefault(); return; } // that press was a long one: no tap
    tap();
  });
  node.addEventListener('contextmenu', (event) => event.preventDefault());
}
