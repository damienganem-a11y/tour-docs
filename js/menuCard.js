// A restaurant's "card": how it is presented to guests, and its menu written in one clean, identical shape for every restaurant
// (SPEC.md "Restaurant menus"). The point (owner, 3 Oct 2026): guests choose a dine-around restaurant for the food, not for how pretty its
// own menu is, so every menu is rewritten into the same sections, the same wording style and the same layout.
//
// Stored on the restaurant as  restaurant.card = { about, cuisine, vibe, interior, outdoor, photos, showPrices, currency, sections }  (or no card).
//   sections: [ { name, items: [ { name, description, price, tags } ] } ]   in the order the restaurant's own menu has them
//   price is text typed by the leader ("18", "18.50"): it is only SHOWN to guests when showPrices is true (otherwise it is not even sent).
//   tags: a few fixed words about the dish (vegetarian, vegan, gluten-free, spicy, to share). Never a guest's allergy: those stay private.
// This file is the one place that says what is allowed, so the leader's form, the text box, the sample trip and the guest sheet agree.

import { goodUrl } from './tourInfo.js';

export const MENU_TAGS = ['vegetarian', 'vegan', 'gluten-free', 'spicy', 'to share'];
const LIMITS = { about: 600, cuisine: 60, vibe: 80, interior: 300, outdoor: 300, currency: 6 };
const MAX_PHOTOS = 6;
const MAX_SECTIONS = 12;
const MAX_ITEMS = 30;
const text = (v) => (typeof v === 'string' ? v.trim() : '');

// Returns an error sentence, or null when `raw` (the card as typed) is acceptable. Missing parts are fine.
export function menuCardError(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') return 'The restaurant card is not valid.';
  const names = { about: 'The description', cuisine: 'The kind of food', vibe: 'The atmosphere', interior: 'The inside description', outdoor: 'The outside description', currency: 'The currency' };
  for (const [field, max] of Object.entries(LIMITS)) {
    if (raw[field] !== undefined && raw[field] !== null && (typeof raw[field] !== 'string' || raw[field].trim().length > max)) return `${names[field]} must be ${max} letters or fewer.`;
  }
  if (raw.photos !== undefined && raw.photos !== null) {
    if (!Array.isArray(raw.photos) || raw.photos.length > MAX_PHOTOS) return `A restaurant can have up to ${MAX_PHOTOS} photos.`;
    if (!raw.photos.every((p) => p && goodUrl(p.url) && (p.caption === undefined || (typeof p.caption === 'string' && p.caption.length <= 120)))) return 'A photo needs a web address starting with https://.';
  }
  if (raw.sections !== undefined && raw.sections !== null) {
    if (!Array.isArray(raw.sections) || raw.sections.length > MAX_SECTIONS) return `A menu can have up to ${MAX_SECTIONS} sections.`;
    for (const section of raw.sections) {
      if (!section || text(section.name) === '' || text(section.name).length > 60) return 'Each menu section needs a name of 60 letters or fewer.';
      if (!Array.isArray(section.items) || section.items.length > MAX_ITEMS) return `"${text(section.name)}" can have up to ${MAX_ITEMS} dishes.`;
      for (const item of section.items) {
        if (!item || text(item.name) === '' || text(item.name).length > 80) return `Each dish in "${text(section.name)}" needs a name of 80 letters or fewer.`;
        if (item.description !== undefined && item.description !== null && (typeof item.description !== 'string' || item.description.trim().length > 200)) return `The description of "${text(item.name)}" must be 200 letters or fewer.`;
        if (item.price !== undefined && item.price !== null && (typeof item.price !== 'string' || item.price.trim().length > 12)) return `The price of "${text(item.name)}" must be 12 characters or fewer.`;
        if (item.tags !== undefined && item.tags !== null && (!Array.isArray(item.tags) || !item.tags.every((t) => MENU_TAGS.includes(t)))) return `The tags of "${text(item.name)}" can only be: ${MENU_TAGS.join(', ')}.`;
      }
    }
  }
  return null;
}

// The clean stored form: trimmed text, no empty parts; null when nothing is left.
export function cleanMenuCard(raw) {
  if (!raw) return null;
  const card = {
    about: text(raw.about), cuisine: text(raw.cuisine), vibe: text(raw.vibe), interior: text(raw.interior), outdoor: text(raw.outdoor),
    photos: (raw.photos ?? []).map((p) => ({ url: p.url, caption: text(p.caption) })),
    showPrices: raw.showPrices === true, currency: text(raw.currency),
    sections: (raw.sections ?? []).map((s) => ({
      name: text(s.name),
      items: s.items.map((i) => ({ name: text(i.name), description: text(i.description), price: text(i.price), tags: MENU_TAGS.filter((t) => (i.tags ?? []).includes(t)) })),
    })),
  };
  const empty = !card.about && !card.cuisine && !card.vibe && !card.interior && !card.outdoor && card.photos.length === 0 && card.sections.length === 0;
  return empty ? null : card;
}

// What a guest receives: the card with prices left out unless the leader chose to show them (a hidden price never leaves the leader's phone).
export function guestMenuCard(card) {
  if (!card) return null;
  return {
    about: card.about || null, cuisine: card.cuisine || null, vibe: card.vibe || null, interior: card.interior || null, outdoor: card.outdoor || null,
    photos: card.photos.map((p) => ({ url: p.url, caption: p.caption || '' })),
    showPrices: card.showPrices, currency: card.currency || '',
    sections: card.sections.map((s) => ({ name: s.name, items: s.items.map((i) => ({ name: i.name, description: i.description || null, price: card.showPrices && i.price ? i.price : null, tags: i.tags })) })),
  };
}

// ---------- the menu as plain text ----------
// The leader (or Claude, from an uploaded menu) writes the menu in one text box:
//     # Shareables
//     Burrata | Fresh tomato, basil, olive oil | 16 | vegetarian, to share
//     # Mains
//     Barramundi | Grilled, lemon butter, greens | 38
// A line starting with # opens a section; a dish is  name | description | price | tags  (everything after the name is optional).
export function parseMenuText(source) {
  const sections = [];
  for (const rawLine of String(source ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) { sections.push({ name: line.replace(/^#+\s*/, ''), items: [] }); continue; }
    if (sections.length === 0) sections.push({ name: 'Menu', items: [] });
    const [name, description = '', price = '', tags = ''] = line.split('|').map((part) => part.trim());
    sections[sections.length - 1].items.push({ name, description, price, tags: tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) });
  }
  return sections;
}

export function menuToText(sections) {
  return (sections ?? []).map((s) => [`# ${s.name}`, ...s.items.map((i) => [i.name, i.description, i.price, i.tags.join(', ')].join(' | ').replace(/( \| )+$/, ''))].join('\n')).join('\n\n');
}
