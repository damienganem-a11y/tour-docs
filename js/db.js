// Saving and loading data on the phone.
//
// Uses IndexedDB, the browser's built-in storage. It works offline and survives closing the app.
// It has three "drawers" (called stores):
//   trips     one item per trip: all of its guests, destinations, activities and bookings
//   journal   one item per change ever made (empty until changes exist; one entry per change)
//   settings  small things about this phone, for example the owner's name
//
// The change function (step 3) writes a trip AND its journal entry in ONE go with withStores(),
// so the two can never disagree, even if the phone dies half way.

const DB_NAME = 'tour-docs';
const DB_VERSION = 2;

let opening; // we open the database once and reuse it

function openDb() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      // Runs the first time, and again when DB_VERSION goes up: make sure every drawer exists.
      request.onupgradeneeded = () => {
        const db = request.result;
        // The first version of the app kept one trip in a drawer called "kv". Not used anymore.
        if (db.objectStoreNames.contains('kv')) db.deleteObjectStore('kv');
        if (!db.objectStoreNames.contains('trips')) db.createObjectStore('trips', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('journal')) {
          db.createObjectStore('journal', { keyPath: 'id' }).createIndex('tripId', 'tripId');
        }
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return opening;
}

// Runs an action on one or more stores inside a single transaction: either everything in it
// is saved, or nothing is. Waits until it is safely written.
//   action receives { trips, journal, ... } (the stores you asked for). If it returns a request
//   (like store.get(...)), that request's result is handed back.
export async function withStores(names, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    const stores = {};
    for (const name of names) stores[name] = tx.objectStore(name);
    const request = action(stores);
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Everyday shortcuts for a single store.
export const dbGet = (store, key) => withStores([store], 'readonly', (s) => s[store].get(key));
export const dbAll = (store) => withStores([store], 'readonly', (s) => s[store].getAll());
export const dbDelete = (store, key) => withStores([store], 'readwrite', (s) => s[store].delete(key));

// Saves a trip and the journal entries of the change that produced it in ONE transaction:
// either both are stored or neither is (a phone that dies half way cannot leave them disagreeing).
export const saveTripAndJournal = (trip, entries) =>
  withStores(['trips', 'journal'], 'readwrite', (s) => {
    s.trips.put(trip);
    for (const entry of entries) s.journal.put(entry);
  });

// The trips and journal drawers know their own key (the item's id). The settings drawer does not:
// there you must give a key, for example dbPut('settings', owner, 'owner').
export const dbPut = (store, value, key) =>
  withStores([store], 'readwrite', (s) => (key === undefined ? s[store].put(value) : s[store].put(value, key)));
