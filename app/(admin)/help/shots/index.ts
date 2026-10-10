import { bookingShots } from "./booking";
import { fleetShots } from "./fleet";
import { operationsShots } from "./operations";
import { accountShots, teamShots } from "./team";
import type { Shot } from "./types";

export type { Action, Label, Shot, ShotMarks, Target } from "./types";

/** Every screenshot in the help manual, in the order they are shot. */
export const SHOTS: Shot[] = [...operationsShots, ...fleetShots, ...bookingShots, ...teamShots, ...accountShots];
