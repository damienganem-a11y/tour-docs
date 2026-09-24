// Use > Dining: the dine-around, day by day. Nothing to show yet — restaurants can only be set up
// in Settings > Dining so far (Phase 3 step 1); booking guests onto them is the next step, and this
// screen becomes the real thing then. Kept as its own file (like destination.js, guest.js) since it
// will grow into the same shape as those once booking exists.

import { h } from '../dom.js';
import { pageHead } from './chrome.js';

export function diningPage(ctx, trip) {
  return h('div', {},
    pageHead({ eyebrow: 'Dining' }),
    h('p', { class: 'empty' }, 'Booking guests onto restaurants is coming soon. Restaurants are set up in Settings > Dining.'));
}
