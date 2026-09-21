// Roll call: plain helpers (they never change anything and never touch the screen).
//
// A roll call is stored inside the trip, in trip.rollCalls, one per activity:
//   { id, activityId, startedAt, startedBy: { id, name }, endedAt: null, endedBy,
//     vehicles: [ { id, number: 1 }, ... ],          V1, V2... (the "V" comes from the trip, see vehicleLabel)
//     checkins: { guestId: vehicleId },              who is in which vehicle, on departure
//     returnCount: null | { startedAt, startedBy, returned: { guestId: vehicleId } } }   the count on the way back
// The roll call ends with "End roll call"; the vehicles and who was in them are then kept for the return count.
// Every change to a roll call goes through the one change function (changes.js) like everything else.

import { newId } from './ids.js';

const DEFAULT_LABEL = 'V'; // used when the trip file does not say what vehicles are called

export const findRollCall = (trip, activityId) => (trip.rollCalls ?? []).find((r) => r.activityId === activityId);

// "V2": the label of a trip's vehicles is data (trip.vehicleLabel), not something fixed for one company.
export const vehicleLabel = (trip, vehicle) => `${trip.vehicleLabel ?? DEFAULT_LABEL}${vehicle.number}`;

// The vehicles a new roll call starts with: 1, 2, 3... up to the number the trip file asks for (default_vehicles).
export const defaultVehicles = (count) => Array.from({ length: count }, (_, i) => ({ id: newId(), number: i + 1 }));

// Where a roll call stands right now.
//   booked      everybody booked on the activity
//   checkedIn   those who are in a vehicle
//   expected    those still to come (the list on the screen)
//   perVehicle  Map: vehicle id -> guests inside
// A guest who was moved off the activity after checking in is simply not counted anymore.
export function rollCallState(trip, rollCall) {
  const activity = trip.activities.find((a) => a.id === rollCall.activityId);
  const booked = trip.guests.filter((g) => trip.bookings[g.id]?.[activity.slotId]?.activityId === activity.id);
  const checkedIn = booked.filter((g) => rollCall.checkins[g.id]);
  const expected = booked.filter((g) => !rollCall.checkins[g.id]);
  const perVehicle = new Map(rollCall.vehicles.map((v) => [v.id, checkedIn.filter((g) => rollCall.checkins[g.id] === v.id)]));
  return { activity, booked, checkedIn, expected, perVehicle };
}

// Where the return count stands: the same vehicles, this time counting the guests back in.
//   back        booked guests already counted back
//   toCount     booked guests not counted back yet (the list on the screen)
//   backPerVehicle     Map: vehicle id -> guests counted back into it
//   missingPerVehicle  Map: vehicle id -> guests who LEFT in it (departure) and are not back yet
export function returnState(trip, rollCall) {
  const state = rollCallState(trip, rollCall);
  const returned = rollCall.returnCount?.returned ?? {};
  const back = state.booked.filter((g) => returned[g.id]);
  const toCount = state.booked.filter((g) => !returned[g.id]);
  return {
    ...state, back, toCount,
    backPerVehicle: new Map(rollCall.vehicles.map((v) => [v.id, back.filter((g) => returned[g.id] === v.id)])),
    missingPerVehicle: new Map(rollCall.vehicles.map((v) => [v.id, (state.perVehicle.get(v.id) ?? []).filter((g) => !returned[g.id])])),
  };
}
