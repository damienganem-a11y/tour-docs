// Who is using the app, and what they are allowed to do.
//
// Today there is one user: the owner, whose name is asked once on first launch. Every user has a
// `role`, and the role decides what they may do. Colleagues and guests come later; adding them
// means adding lines to PERMISSIONS below (for example, letting a colleague "request" a change).

export const makeOwner = (id, name) => ({ id, name, role: 'owner' });

const PERMISSIONS = {
  owner: ['change', 'force'], // can change anyone's bookings directly, and force a move into a full tour
  team: ['change'],    // invited to work on a trip: asks for changes (sent as requests, applied by the owner's device: see changes.js)
  viewer: [],          // invited to look only
  colleague: [],       // (old name, kept so nothing breaks)
  guest: [],           // later
};

export function canUser(user, action) {
  return (PERMISSIONS[user?.role] ?? []).includes(action);
}
