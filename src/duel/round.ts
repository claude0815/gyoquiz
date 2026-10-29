import type { Question } from '../catalogue';
import { createRound, isAnswered, isCorrect, type Round } from '../engine';
import { hashString, seededRng, shuffle } from '../rng';
import { MAX_TENTHS, type DuelPlayer } from './link';

/** Antwortreihenfolge einer Frage im Duell: hängt nur von Seed und Fragen-ID ab, nicht von der Position. */
export function answerOrder(seed: number, questionId: string): number[] {
  return shuffle([0, 1, 2, 3], seededRng(hashString(`${seed}:${questionId}`)));
}

export function createDuelRound(questions: readonly Question[], seed: number): Round {
  return createRound(questions, q => answerOrder(seed, q.id));
}

export function msToTenths(ms: number): number {
  return Math.min(MAX_TENTHS, Math.max(0, Math.round(ms / 100)));
}

/** Ergebnis einer (auch aufgegebenen) Runde: offene Fragen zählen als falsch mit Höchstzeit. */
export function playerFromRound(name: string, round: Round): DuelPlayer {
  return {
    n: name,
    r: round.items.map(it => (isCorrect(it) ? '1' : '0')).join(''),
    t: round.items.map(it => (isAnswered(it) ? msToTenths(it.ms ?? 0) : MAX_TENTHS)),
  };
}

/** Ergebnis je Frage für den laufenden Spielstand: true/false oder null, solange offen. */
export function resultsOf(round: Round): Array<boolean | null> {
  return round.items.map(it => (isAnswered(it) ? isCorrect(it) : null));
}
