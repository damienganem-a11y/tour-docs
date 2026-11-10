// Example maps (v0.145.2, owner's request, 5 Nov 2026: "just make it up, for me to have a look"). One tap fills an empty stop with a made-up example, to
// try the guests' map or to show it to someone. The places are INVENTED (names, hours, prices, tips): never send them to real guests as they are.
// The start point is an estimate (the river bank in front of the Saint-Joseph Saint-Luc hospital, quai Claude Bernard, Lyon 7e): move it with "Change".
// Offered ONLY on a demo trip (a trip whose name says "fictional", v0.147.1): a real trip to Lyon is never offered made-up restaurants.
// Keyed by the destination's name in lower case.

export const EXAMPLE_MAPS = {
  lyon: {
    dock: { lat: 45.7489, lng: 4.8378, label: 'The ship' },
    backBy: '18:30',
    places: [
      { id: 'ex-lyon-1', name: 'Le Bouchon du Quai (example)', kind: 'food', lat: 45.7501, lng: 4.8409, price: 'Menu €32', hours: '12:00 to 14:00, 19:00 to 22:30', tip: 'Lyon classics: quenelle, salade lyonnaise, praline tart. Book for dinner, it is small.' },
      { id: 'ex-lyon-2', name: 'Café des Berges (example)', kind: 'food', lat: 45.7476, lng: 4.8381, price: '€', hours: '8:00 to 23:00', tip: 'Right on the river walk, two minutes from the ship. A terrace in the sun after 15:00.' },
      { id: 'ex-lyon-3', name: 'La Table de Gryphe (example)', kind: 'food', lat: 45.7506, lng: 4.8436, price: 'Mains €18 to €26', hours: '12:00 to 14:30, 19:30 to 22:00, closed Sundays', tip: 'Market cooking, the menu changes every day. Ask for the cheese from the Saint-Marcellin.' },
      { id: 'ex-lyon-4', name: 'Pizzeria Raspail (example)', kind: 'food', lat: 45.7524, lng: 4.8402, price: '€12 to €16', hours: '11:30 to 23:00', tip: 'Wood-fired pizzas, good for families and a quick lunch.' },
      { id: 'ex-lyon-5', name: 'Boulangerie Chevreul (example)', kind: 'food', lat: 45.7481, lng: 4.8426, price: '€', hours: '7:00 to 19:30, closed Mondays', tip: 'Pink praline brioche, the Lyon speciality. Sells out by noon.' },
      { id: 'ex-lyon-6', name: 'Les Halles du Septième (example)', kind: 'market', lat: 45.7469, lng: 4.8446, price: 'Free to walk in', hours: 'Tuesday to Sunday, 8:00 to 13:30', tip: 'Cheese, charcuterie and wine to take back on board.' },
    ],
  },
};

export const exampleMapFor = (destination) => EXAMPLE_MAPS[String(destination?.name ?? '').trim().toLowerCase()] ?? null;
