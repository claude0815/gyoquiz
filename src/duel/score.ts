import type { DuelPlayer } from './link';

/** Aus Sicht der vergleichenden Person. */
export type Outcome = 'win' | 'loss' | 'draw';

export interface Comparison {
  outcome: Outcome;
  myCorrect: number;
  otherCorrect: number;
  /** Gesamtzeit des Gegners minus eigene Gesamtzeit; positiv heißt: ich war schneller. */
  timeDiffTenths: number;
}

export const correctCount = (p: DuelPlayer): number => [...p.r].filter(ch => ch === '1').length;
export const totalTenths = (p: DuelPlayer): number => p.t.reduce((s, v) => s + v, 0);

/** Mehr richtige gewinnt, bei Gleichstand die kürzere Gesamtzeit, exakt gleich ist unentschieden. */
export function compare(me: DuelPlayer, other: DuelPlayer): Comparison {
  const myCorrect = correctCount(me);
  const otherCorrect = correctCount(other);
  const timeDiffTenths = totalTenths(other) - totalTenths(me);
  let outcome: Outcome;
  if (myCorrect !== otherCorrect) outcome = myCorrect > otherCorrect ? 'win' : 'loss';
  else if (timeDiffTenths !== 0) outcome = timeDiffTenths > 0 ? 'win' : 'loss';
  else outcome = 'draw';
  return { outcome, myCorrect, otherCorrect, timeDiffTenths };
}

/**
 * Laufender Spielstand bis einschließlich Frage `upTo`.
 * `mine` enthält je Frage true/false oder null (noch offen); offene Fragen zählen auch beim Gegner nicht.
 */
export function runningScore(mine: ReadonlyArray<boolean | null>, other: DuelPlayer, upTo: number): { me: number; other: number } {
  let me = 0, them = 0;
  for (let i = 0; i <= upTo && i < mine.length; i++) {
    if (mine[i] === null) continue;
    if (mine[i]) me++;
    if (other.r[i] === '1') them++;
  }
  return { me, other: them };
}

/** Zehntelsekunden als „41,2 s“. */
export function formatTenths(tenths: number): string {
  return `${(tenths / 10).toFixed(1).replace('.', ',')} s`;
}
