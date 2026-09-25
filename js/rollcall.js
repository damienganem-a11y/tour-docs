// Roll call: plain helpers (they never change anything and never touch the screen).
//
// A roll call is stored inside the trip, in trip.rollCalls, one per activity:
//   { id, activityId, startedAt, startedBy: { id, name }, endedAt: null, endedBy,
//     vehicles: [ { id, number: 1 }, ... ],          V1, V2... (the "V" comes from the trip, see vehicleLabel)
//     checkins: { guestId: vehicleId },              who is in which vehicle
//     movedByEnd: [ guestId, ... ] }                 the guests "End roll call" moved to At leisure (Re-open roll call puts them back)
// The roll call ends with "End roll call"; "Re-open roll call" opens it again, with its vehicles and check-ins.
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
  const booked = trip.guests.filter((g) => {
    const booking = trip.bookings[g.id]?.[activity.slotId];
    return !g.leftAt && booking?.kind === 'activity' && booking.activityId === activity.id;
  });
  const checkedIn = booked.filter((g) => rollCall.checkins[g.id]);
  const expected = booked.filter((g) => !rollCall.checkins[g.id]);
  const perVehicle = new Map(rollCall.vehicles.map((v) => [v.id, checkedIn.filter((g) => rollCall.checkins[g.id] === v.id)]));
  return { activity, booked, checkedIn, expected, perVehicle };
}
