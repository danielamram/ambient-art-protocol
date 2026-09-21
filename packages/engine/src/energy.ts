import { expDamp } from './damp.js';

/**
 * The activity envelope behind `u_energy`: a pulse-rate follower. Every pulse adds
 * `magnitude * gain`, clamped to 1, and the value decays toward 0 with time constant `tau`.
 * Where `u_pulse` says "how strong is the loudest live pulse", energy says "how busy is the
 * stream", so a whole scene can breathe with data volume.
 */
export function addEnergy(energy: number, magnitude: number, gain: number): number {
  const next = energy + Math.max(0, magnitude) * Math.max(0, gain);
  return next > 1 ? 1 : next;
}

export function decayEnergy(energy: number, dt: number, tau: number): number {
  // expDamp snaps to the target on a zero dt; a zero-length tick must leave energy alone.
  if (!(dt > 0)) return energy;
  return expDamp(energy, 0, tau, dt);
}
