// Passport Explorer: the mini-games. Each is a plain module ported from the owner's prototype, with the same shape:
//   engine(host, hud, onEnd, skin) returns { start, stop, move }, and calls onEnd({ star, title, text }) when the game is over.
// The trip file names a step's game and skin; a pair not listed here is not built (the step then shows "Skip for now").
import { runner, runnerSkins } from './runner.js';
import { fit, fitSkins } from './fit.js';
import { sequence, sequenceSkins } from './sequence.js';
import { pour, pourSkins } from './pour.js';
import { mirror, mirrorSkins } from './mirror.js';
import { rhythm, rhythmSkins } from './rhythm.js';
import { catchGame, catchSkins } from './catch.js';
import { flap, flapSkins } from './flap.js';
import { hidden, hiddenSkins } from './hidden.js';
import { spot, spotSkins } from './spot.js';
import { archery, archerySkins } from './archery.js';
import { maze, mazeSkins } from './maze.js';
import { carve, carveSkins } from './carve.js';
import { pipes, pipesSkins } from './pipes.js';

export const ENGINES = { runner, fit, sequence, pour, mirror, rhythm, catch: catchGame, flap, hidden, spot, archery, maze, carve, pipes };
export const SKINS = { runner: runnerSkins, fit: fitSkins, sequence: sequenceSkins, pour: pourSkins, mirror: mirrorSkins, rhythm: rhythmSkins, catch: catchSkins, flap: flapSkins,
  hidden: hiddenSkins, spot: spotSkins, archery: archerySkins, maze: mazeSkins, carve: carveSkins, pipes: pipesSkins };
export const hasGame = (engine, skin) => Boolean(ENGINES[engine] && SKINS[engine]?.[skin]);
