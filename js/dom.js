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
