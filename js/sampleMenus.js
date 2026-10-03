// Presentations and menus of the sample trips' dine-around restaurants (Port Douglas, Australia). Loaded from the owner's own dine-around
// document (3 Oct 2026) and rewritten into the app's one common style (see menuCard.js): same section names where possible, short plain
// descriptions, tags only for vegetarian / vegan / gluten-free / spicy / to share. Prices are kept but hidden from guests by default.
// People's names (chefs, owners) and wine suggestions are left out on purpose.

import { parseMenuText } from './menuCard.js';

function card(fields, menuText, picture) {
  return { ...fields, photos: [{ url: picture, caption: '' }], showPrices: false, currency: 'AUD', sections: parseMenuText(menuText) };
}

export const SAMPLE_CARDS = {
  Salsa: card({
    cuisine: 'Modern Australian', vibe: 'Lively and relaxed',
    about: 'The locals\' favourite for more than twenty-five years. Global flavours built on local produce, in the liveliest room of the evening.',
    interior: 'An open-air Queenslander with the breeze moving through it.',
    outdoor: 'A view across the inlet to the church on the far shore.',
  }, `# Starters
Crispy cauliflower | Sichuan black bean sauce, edamame, pickled shallots | 28.8 | vegetarian, spicy
Citrus pepper calamari | Nduja aioli, artichoke, heirloom tomato, rocket | 30.5
Tiger prawn gyoza | Shio koji emulsion, peanut rayu, spring onion | 31
Salmon sashimi | Yuzu dressing, wasabi pea furikake, kohlrabi | 32.5
Hot and sour pork belly | Toffee glaze, macadamia crumble, apple ginger slaw | 33
Oysters of the day | Half dozen | 36
# Mains
Gnocchi of the day | Starter or main size | 33 / 42.9
Linguini pepperoncino | Tiger prawns, black pepper, garlic, chilli, parmesan | 42 / 49.5 | spicy
Chermoula chicken | Pumpkin burek, whipped mint labna, pomegranate jus | 44.5
Pork tenderloin | Root vegetable remoulade, beetroot, fennel, quince | 46.5
Dukkah-crusted barramundi | Maple miso glaze, sweet potato purée | 48.5
Duck breast | Confit duck bonbons, chickpea panisse, apple and rhubarb relish | 48.9
Seafood curry | Redclaw, prawns, squid, mussels, pipis, jasmine rice | 49.5 | spicy
Black Angus eye fillet | 200 g, truffled potato, onion jam, green peppercorn | 59.9
# Salads and sides
House salad | Field greens, goat's cheese, mandarin, almonds | 23.9 | vegetarian
Caesar salad | | 24.9
Fries | Plain, or with Old Bay seasoning and ranch | 13.9
Duck fat kipflers | Black garlic aioli | 16.5
Steamed greens | Cultured butter | 18.8 | vegetarian
# Desserts
Ice cream selection | Meringue, raspberry coulis | 17.9 | vegetarian, gluten-free
Yoghurt crémeux | Rhubarb, strawberry sorbet, wattle seed tuille | 21 | vegetarian
Chocolate and orange soufflé | | 22 | vegetarian
Tasting plate for two | | 31.5 | vegetarian, to share
Affogato | Vanilla ice cream, with liqueur or tequila | 23 | vegetarian`, 'demo/cooking-1.svg'),

  Melaleuca: card({
    cuisine: 'Modern Australian', vibe: 'Warm, stylish, unhurried',
    about: 'Modern Australian cooking with Asian accents, in a warm room a little away from the bustle. One of the most consistently praised rooms in town.',
    interior: 'A warm, stylish room by the marina.',
    outdoor: 'Tables on the railing, looking out across the water.',
  }, `# Starters
House baked bread | Maple whipped butter | 12 | vegetarian
Pig ears | Granny Smith apple purée | 12
Chicken liver paté | Crostini, cornichons, orange jelly | 16
Oysters | Soy and green onion, natural, or kilpatrick. Half dozen / dozen | 30 / 58
Soft shell mud crab | Green papaya salad, chilli, lime, lychees | 29 | gluten-free
Tempura bugs | Candied chilli and ginger, sticky soy, macadamia | 28
Char-grilled prawns | Malaysian chilli and coconut sauce, coriander | 28 | gluten-free
Beef tataki | Nahm jim dressing, snow pea and bean shoot salad | 28
Seared scallops | Bush-smoked bacon, sweetcorn purée, crispy leek | 28
Bangalow pork belly | Asian herb salad, sticky Vietnamese dressing | 27
Kingfish ceviche | Green chilli, lime, coconut espuma, crispy shallots | 27
Arancini | Sundried tomato, burnt goat's cheese, spiced nashi pear | 26 | vegetarian
# Mains
Pan-seared barramundi | Cauliflower and vanilla purée, fennel, broccolini | 44 | gluten-free
Yellowfin tuna | Warm kipfler potato salad, chorizo, green beans, olives | 42 | gluten-free
Moreton Bay bugs | Panang curry sauce, pineapple, bean sprouts, jasmine rice | 48 | gluten-free
Whole baby barramundi | Panko-crumbed, Thai caramel, bean shoot salad, rice | 46
Slow-braised beef cheek | Whipped potato, baby vegetables, beetroot pesto | 46
Crispy pork belly | Parsnip purée, cabbage, apple, pan juices | 42 | gluten-free
Flame-grilled eye fillet | Dauphinoise potato, mushroom duxelles, pinot noir jus | 54
House-made gnocchi | Oyster mushrooms, pumpkin purée, pine nuts, truffle oil | 42 | vegetarian
# Sides
Melaleuca's chips | Thrice-cooked, pink salt, garlic aioli | 14 | vegetarian
Roasted spiced pumpkin | Yoghurt, almonds, coriander | 16 | vegetarian, gluten-free
Sautéed kipfler potatoes | Pancetta, grana padano | 16 | gluten-free
Mustard spiced greens | Broccolini, green beans, kale | 16 | vegetarian, gluten-free
Mixed leaf salad | Walnuts, white balsamic, parmesan | 14 | vegetarian, gluten-free`, 'demo/beach-1.svg'),

  'La Cucina': card({
    cuisine: 'Italian', vibe: 'Seaside, with a bar',
    about: 'A traditional Italian menu served with contemporary elegance: handmade pasta, chargrilled steaks and local seafood, with a lightness that suits the tropics. A bar for a cocktail before you sit down.',
    interior: 'A bright room with a bar at the front.',
    outdoor: 'Sea-side, at the top of the main street.',
  }, `# Starters
Coral trout crudo | Kaffir lime oil, citrus soy, finger lime, caviar | 32
Salmon carpaccio | Olive oil, citrus soy, chilli, parsley | 29.5
Spicy yellowfin tuna tartare | Sesame-soy dressing, shallots, peanuts, stracciatella | 28.5 | spicy
Spanner crab mantecato | Whipped crab, house pickles, anchovy, lemon curd | 29.5 | gluten-free
Buffalo burrata | Crostini, heirloom tomatoes, basil, balsamic | 29.5 | vegetarian
Kangaroo carpaccio | Burnt pepper, shallots, goat's cheese, horseradish cream | 29.5
Beef tartare | Tenderloin, caramelised onion, grana padano, pistachio pesto | 29.5
Whiting beccafico | Baked fillets, pistachio crumb, raspberry onion | 25.5
Pan-seared scallops | Cauliflower purée, saffron reduction, trout roe | 28.5 | gluten-free
Charred baby octopus | Soy, lime and chilli skewers, sour cream | 29.5
# Pasta
Squid-ink spaghetti | Local prawns, basil, lemon, cherry tomatoes | 42.5
Seafood linguine | Prawns, bugs, mussels, clams, salmon, barramundi | 44.5
Spaghetti vongole | Clams, white wine, garlic, parsley | 43.5
Spaghetti puttanesca | Olives, capers, garlic, chilli, breadcrumbs | 39.5 | vegetarian
Cavatelli Genovese ragù | Handmade ricotta cavatelli, slow-cooked white beef ragù | 43
Fusilli Bolognese | Traditional pork and beef ragù | 39.5
Sage and carrot risotto | Gruyère, spicy tuna tartare, burrata | 43 | gluten-free
# From the land and sea
Beef tenderloin | 200 g, mash, bone marrow, green peppercorn sauce | 59.5 | gluten-free
Braised beef cheek | 72 hours in red wine jus, mash, red cabbage | 54 | gluten-free
Orange duck leg | Sous-vide, orange reduction, sage and carrot purée | 44 | gluten-free
Chicken roast | Prosciutto-wrapped thighs, spinach, mozzarella, peperonata | 46 | gluten-free
Coral trout acqua pazza | Poached in tomato, garlic and chilli broth | 46.9
Yellowfin tuna steak | Mojito herbs, chilli, fennel and herb salad, pistachio | 44
Daintree barramundi | Pan-fried, zucchini, lemon and sage curd | 44.5 | gluten-free
# To share
Seafood platter | Bugs, prawns, baby octopus, tuna, barramundi, scallops, mussels | 178 | to share
Linguine with crayfish | A whole 700 g painted crayfish, cherry tomatoes | 149
# Sides
Roasted potato | Garlic and rosemary | 14 | vegetarian, vegan, gluten-free
Green leaf salad | | 14 | vegetarian, vegan, gluten-free
Sautéed vegetables | | 16 | vegetarian, vegan, gluten-free
Marinated olives | Fennel seed, chilli, lemon zest | 9 | vegetarian, vegan, gluten-free
Ciabatta | Warm, with olive oil and balsamic | 13 | vegetarian, vegan`, 'demo/cooking-2.svg'),

  Zinc: card({
    cuisine: 'Contemporary Australian', vibe: 'Elegant, woodfire grill',
    about: 'One of the town\'s landmark rooms since 2004. Australian fusion from a woodfire grill: meat is butchered in house daily and cooked over native hardwood and charcoal. A seafood tasting menu is offered for the earlier seating only.',
    interior: 'An elegant room.',
    outdoor: 'An open-air garden, a short walk from the beach.',
  }, `# Starters
Sourdough cobb loaf | Smoked maple butter | 16.5 | vegetarian
Wagyu beef | Miso soy glaze, finger lime, chilli mayo | 29 | gluten-free
Tasmanian salmon sashimi | Yuzu ponzu, miso mayo, furikake | 31
Kingfish ceviche | Mango leche de tigre, corn, chilli, taro chips | 33 | gluten-free
Local grilled prawns | XO butter sauce, bacon dust, potato crisps | 32 | gluten-free
Oyster mushrooms | Cauliflower and almond purée, chimichurri, pickled shallots | 27 | vegan, gluten-free
# From the grill
Bangalow pork cutlet | 300 g, orange soy broth, bok choy, lemon | 48 | gluten-free
Eye fillet | 200 g grain-fed Hereford beef | 66 | gluten-free
Scotch fillet | 300 g grass-fed beef | 74 | gluten-free
Wagyu rump | 250 g | 65 | gluten-free
# Mains
House-made gnocchi | Lamb ragù, feta and parmesan cream | 49
Barramundi fillet | Coconut curry, sautéed cabbage, herb salad, crispy shallots | 50 | gluten-free
Prawn linguine | Prawns, bisque, butter, cherry tomato, garlic, chilli | 49
Puttanesca | Linguini, olives, capers, cherry tomatoes | 41 | vegan
Risotto | Porcini and golden oak mushroom, parmesan | 44 | vegetarian, gluten-free
# Sides
Local mesclun lettuce | Pumpkin, feta, beetroot, croutons, sherry vinaigrette | 22 | vegetarian
Seasonal mixed greens | Garlic butter, toasted almonds | 18 | gluten-free
Chat potatoes | Labneh and chimichurri | 16 | gluten-free
Shoestring fries | | 14 | vegan, gluten-free
House-made focaccia | Balsamic and olive oil | 12 | vegan
Steamed rice | | 9 | vegan, gluten-free
# Seafood tasting experience
Five courses | Focaccia, salmon sashimi, kingfish ceviche, grilled prawns, barramundi, chef's dessert. Earlier seating only | 125`, 'demo/beach-2.svg'),

  'Wrasse & Roe': card({
    cuisine: 'Seafood', vibe: 'Bright, by the beach',
    about: 'The seafood specialist: sustainably harvested Australian seafood, with the catch as the hero on the plate.',
    interior: 'Polished concrete, turquoise banquettes and warm pendant light.',
    outdoor: 'Market umbrellas outside, at the beach end of the main street.',
  }, `# Entrées
Oysters | Natural, red wine vinegar, or citrus soy. Half dozen / dozen | 36 / 72
Calamari | Salsa verde, caramelised lemon, beetroot gel | 28.5
Seared scallops | Cauliflower and truffle purée, pancetta | 29.9 | gluten-free
Rare wagyu beef | Green shallot, daikon, chilli eggplant compote | 29.5
Salmon carpaccio | Citrus soy, lime, coriander, coconut cream | 29.9
Yellowfin tuna | Furikake, miso sauce, pickled slaw | 29.5
Thai duck salad | Green shallot, chilli lime dressing, grapes, roasted rice | 29.9 | gluten-free
Roast baby beetroot | Pita, rocket, feta, pine nuts | 26.5 | vegetarian
# Mains
Barramundi fillet | With your choice of accompaniment | 49
Market catch of the day | With your choice of accompaniment | Market price
Seafood marinara | Prawn, reef fish, clams, mussels, calamari, linguine | 49.5
Baked tiger prawns | Coconut laksa sauce, Asian greens, rice | 49.5 | gluten-free
Eye fillet steak | Kipfler potatoes, spinach, onion jam, red wine jus | 56 | gluten-free
Steamed black mussels | White wine garlic butter, half a warm sourdough | 43
Whole baby barramundi | Wok-tossed Asian greens, rice, sweet chilli sauce | 51.5 | gluten-free
Parmesan and pea risotto | Parsley, spinach | 46 | vegetarian, gluten-free
Roast duck breast | Beetroot chutney, kipfler potatoes, green beans | 54 | gluten-free
Mud crab | Chilli, black pepper, or garlic butter | Market price
Hot and cold seafood platter | For two | 220 | to share
# Sides
Rocket salad | Apple, parmesan, currants, hazelnuts | 17 | vegetarian, gluten-free
Green leaf salad | | 15 | vegetarian, gluten-free
Seasonal Asian greens | Lime, sesame | 17 | gluten-free
Thick-cut chips | Garlic aioli | 13 | vegetarian
Steamed rice | | 12 | vegetarian
# Desserts
Vanilla panna cotta | Strawberry compote, chocolate ice cream | 19 | vegetarian
Passionfruit parfait | Raspberry, Italian meringue | 19 | vegetarian
Deconstructed lemon tart | Lemon curd, sweet pastry, lemon sorbet | 20 | vegetarian
Chocolate délice | Flourless chocolate cake, orange mousse, gelato | 20 | vegetarian, gluten-free
Dessert platter for two | Three desserts plated together | 38 | vegetarian, to share`, 'demo/boat-1.svg'),
};
