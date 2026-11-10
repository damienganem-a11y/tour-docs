// The ONE safe way to put things inside an element (v0.147.1). The browser's own replaceChildren writes an empty spot as the word "null" on the screen
// (the owner saw it four times: album, reception page, map card, scanner). putIn opens lists inside lists and leaves empty spots (null, undefined,
// false) out. Every screen of the staff app, the guest app, the reception page and the guide's page uses it; a test checks nobody calls
// replaceChildren directly any more.
export function putIn(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}
