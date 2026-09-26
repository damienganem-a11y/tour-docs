// Saving and loading data on the phone.
//
// Uses IndexedDB, the browser's built-in storage. It works offline and survives closing the app.
// It has five "drawers" (called stores):
//   trips      one item per trip: all of its guests, destinations, activities and bookings
//   journal    one item per change ever made (empty until changes exist; one entry per change)
//   exports    one item per PDF ever exported (the file itself, so a past version can be found again)
//   settings   small things about this phone, for example the owner's name
//   syncState  per trip, how far this phone's pushes to Supabase are known to have reached (Phase 2,
//              step 2b) — never part of the trip itself, so pulling another phone's trip down never
//              overwrites THIS phone's own record of what it has confirmed pushing
//
// The change function (step 3) writes a trip AND its journal entry in ONE go with withStores(),
// so the two can never disagree, even if the phone dies half way.

const DB_NAME = 'tour-docs';
const DB_VERSION = 4;

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
        if (!db.objectStoreNames.contains('exports')) {
          db.createObjectStore('exports', { keyPath: 'id' }).createIndex('tripId', 'tripId');
        }
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
        if (!db.objectStoreNames.contains('syncState')) db.createObjectStore('syncState', { keyPath: 'tripId' });
      };
      request.onsuccess = () => {
        const db = request.result;
        // If ANOTHER tab/window of the app is opened later needing a newer version, this connection
        // must get out of its way — otherwise that other tab would wait forever with no message,
        // exactly like this one would below if nothing closed the connection blocking IT.
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      // Another tab/window already has the database open on an older version and hasn't closed it
      // (typically: a second tab left open in the background). Without this, the upgrade above just
      // never runs and the app waits on its boot splash forever, with no error and no way out.
      request.onblocked = () => reject(new Error(
        'Another open tab or window of Tour Docs needs to be closed first. Close every other Tour Docs tab/window, then reload this one.'
      ));
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

// How far this phone's pushes to Supabase for a trip are known to have reached (see syncState
// above). Read-modify-write with Math.max, never a plain overwrite: two pushes for the same trip
// can be confirmed out of order, and a late confirmation for an older count must never regress a
// higher one already recorded.
export async function getPushedChangeCount(tripId) {
  const row = await dbGet('syncState', tripId);
  return row?.pushedChangeCount;
}

export async function bumpPushedChangeCount(tripId, changeCount) {
  return withStores(['syncState'], 'readwrite', (s) => {
    const request = s.syncState.get(tripId);
    request.onsuccess = () => {
      const current = request.result?.pushedChangeCount ?? -1;
      if (changeCount > current) s.syncState.put({ tripId, pushedChangeCount: changeCount });
    };
  });
}
