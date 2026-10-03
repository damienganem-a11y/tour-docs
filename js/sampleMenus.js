// Fictional presentations and menus for the sample trips' dine-around restaurants (invented text: no real restaurant's menu).
// They show what the guest sees: every menu in the same sections and the same wording style, prices hidden by default.
// Written in the text form of menuCard.js, so this is also an example of what an uploaded menu is turned into.

import { parseMenuText } from './menuCard.js';


function card(fields, menuText, picture) {
  return { ...fields, photos: [{ url: picture, caption: '' }], showPrices: false, currency: 'AUD', sections: parseMenuText(menuText) };
}

export const SAMPLE_CARDS = {
  Salsa: card({
    cuisine: 'Latin American', vibe: 'Lively and colourful',
    about: 'Bright, noisy and friendly. Dishes arrive as they are ready and everything is made to be passed around the table.',
    interior: 'Warm lighting, painted tiles, an open kitchen you can watch. Can be loud at 8 pm.',
    outdoor: 'A small covered terrace with ceiling fans, a few steps from the beach path.',
  }, `# Shareables
Corn ribs | Smoked chilli butter, lime, fresh cheese | 14 | vegetarian, spicy, to share
Ceviche | Local white fish, lime, coriander, sweet potato | 22 | gluten-free
# Mains
Slow pork | Citrus-braised shoulder, soft tortillas, pickled onion | 34
Charred cauliflower | Green sauce, toasted seeds, black beans | 28 | vegan
# Desserts
Churros | Warm, with dark chocolate sauce | 12 | vegetarian`, 'demo/cooking-1.svg'),
  Melaleuca: card({
    cuisine: 'Modern Australian', vibe: 'Calm and natural',
    about: 'A quiet garden restaurant built around local produce. The menu is short and changes with the season.',
    interior: 'Timber and glass, soft light, a little hush. Easy for conversation.',
    outdoor: 'A garden under tall trees with a few tables on the lawn. Insect repellent is provided.',
  }, `# Starters
Heirloom tomatoes | Whipped ricotta, basil oil | 18 | vegetarian
Prawn toast | Sesame, chilli jam | 20
# Mains
Barramundi | Grilled, lemon butter, garden greens | 38 | gluten-free
Mushroom risotto | Roasted mushrooms, parmesan, herbs | 32 | vegetarian
# Desserts
Pavlova | Passionfruit, cream, tropical fruit | 14 | gluten-free`, 'demo/beach-1.svg'),
  'La Cucina': card({
    cuisine: 'Italian', vibe: 'Family and generous',
    about: 'Hand-made pasta and wood-fired pizza in big portions. A good choice for hungry groups.',
    interior: 'Checked tablecloths, a pizza oven in the corner, a warm and busy room.',
    outdoor: 'A few pavement tables in front, with a view of the main street.',
  }, `# Starters
Burrata | Tomato, basil, olive oil | 18 | vegetarian, to share
Calamari | Lightly fried, lemon, aioli | 19
# Pasta and pizza
Tagliatelle ragù | Slow-cooked beef and pork sauce | 29
Margherita | Tomato, mozzarella, basil | 24 | vegetarian
# Desserts
Tiramisu | Espresso, mascarpone, cocoa | 13 | vegetarian`, 'demo/cooking-2.svg'),
  Zinc: card({
    cuisine: 'Seafood and grill', vibe: 'Stylish, lively bar',
    about: 'A polished corner restaurant with a long bar. Fresh seafood, charcoal grill, a good cocktail list.',
    interior: 'Zinc bar, leather seats, dim light and music. Busy and energetic after 8 pm.',
    outdoor: 'A pavement terrace for people-watching.',
  }, `# Raw and cold
Oysters | Natural, lemon, mignonette | 6 | gluten-free
Tuna crudo | Citrus, chilli, sesame | 24 | spicy
# From the grill
Spiced lamb | Charcoal grilled, yoghurt, flatbread | 42
Whole fish of the day | Grilled with herbs and lemon | 46 | gluten-free, to share
# Sweet
Chocolate pot | Salted caramel, cream | 14 | vegetarian`, 'demo/beach-2.svg'),
  'Wrasse & Roe': card({
    cuisine: 'Seafood', vibe: 'Casual, by the water',
    about: 'Simple seafood, served fast and fresh, close to the marina. Relaxed and informal.',
    interior: 'A bright dining room with big windows over the water.',
    outdoor: 'A deck over the marina: the best seats at sunset.',
  }, `# Shareables
Salt and pepper squid | Lime, chilli | 18 | spicy, to share
Fish tacos | Crisp fish, slaw, lime crema | 20
# Mains
Reef fish and chips | Beer-battered, salad, tartare | 29
Chilli crab linguine | Fresh crab, tomato, herbs | 36 | spicy
# Desserts
Coconut panna cotta | Mango, toasted coconut | 12 | vegetarian, gluten-free`, 'demo/boat-1.svg'),
};
