// Passport Explorer: the mini-games that exist so far. Each is a plain module ported from the owner's prototype, with the same shape:
//   engine(host, hud, onEnd, skin) returns { start, stop, move }, and calls onEnd({ star, title, text }) when the game is over.
// The trip file names a step's game and skin; a pair not listed here is not built yet (the step then shows "Skip for now").
import { runner, runnerSkins } from './runner.js';
import { fit, fitSkins } from './fit.js';

export const ENGINES = { runner, fit };
export const SKINS = { runner: runnerSkins, fit: fitSkins };
export const hasGame = (engine, skin) => Boolean(ENGINES[engine] && SKINS[engine]?.[skin]);
