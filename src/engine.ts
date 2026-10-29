import type { Question } from './catalogue';
import { shuffle, type Rng } from './rng';

/** Lernstand je Frage (nur im Browser gespeichert). */
export interface QuestionStats {
  right: number;
  wrong: number;
  lastCorrect: boolean;
}
export type StatsMap = Record<string, QuestionStats>;

export interface RoundItem {
  questionId: string;
  /**
   * Anzeige-Reihenfolge der Antworten als Indizes in `[correct, ...wrong]`.
   * Der Wert 0 steht für die richtige Antwort.
   */
  order: number[];
  /** Gewählte Anzeige-Position (0–3) oder null, solange unbeantwortet. */
  chosen: number | null;
  /** Antwortzeit in Millisekunden ab Anzeige der Frage. */
  ms: number | null;
}

export interface Round {
  items: RoundItem[];
  index: number;
}

export interface RoundSummary {
  total: number;
  answered: number;
  correct: number;
  /** Anteil richtiger an beantworteten Fragen in Prozent (gerundet). */
  pct: number;
  /** Notenpunkte 0–15 nach dem üblichen Abitur-Raster. */
  points: number;
  /** Summe der Antwortzeiten in Millisekunden. */
  totalMs: number;
}

/** Antworten einer Frage in Grundreihenfolge: richtige zuerst. */
export function optionsOf(q: Question): string[] {
  return [q.correct, ...q.wrong];
}

/** Zufällige Antwortreihenfolge für den Lernmodus. Für Duelle eine seeded Rng übergeben. */
export function randomOrder(rng: Rng = Math.random): number[] {
  return shuffle([0, 1, 2, 3], rng);
}

export function createRound(questions: readonly Question[], orderFor: (q: Question) => number[] = () => randomOrder()): Round {
  return {
    index: 0,
    items: questions.map(q => ({ questionId: q.id, order: orderFor(q), chosen: null, ms: null })),
  };
}

export function isAnswered(item: RoundItem): boolean {
  return item.chosen !== null;
}

export function isCorrect(item: RoundItem): boolean {
  return item.chosen !== null && item.order[item.chosen] === 0;
}

/** Trägt eine Antwort ein. Gibt false zurück, wenn die Frage schon beantwortet war. */
export function answer(item: RoundItem, position: number, ms: number): boolean {
  if (item.chosen !== null) return false;
  if (!Number.isInteger(position) || position < 0 || position >= item.order.length) throw new RangeError('Ungültige Antwortposition');
  item.chosen = position;
  item.ms = Math.max(0, Math.round(ms));
  return true;
}

/** Notenpunkte aus Prozent nach dem verbreiteten Abitur-Bewertungsraster. */
export function pctToPoints(pct: number): number {
  const table: Array<[number, number]> = [
    [95, 15], [90, 14], [85, 13], [80, 12], [75, 11], [70, 10], [65, 9], [60, 8],
    [55, 7], [50, 6], [45, 5], [40, 4], [33, 3], [27, 2], [20, 1],
  ];
  for (const [min, points] of table) if (pct >= min) return points;
  return 0;
}

/** Note mit Tendenz zu Notenpunkten (Index = Punkte), nach § 12 Abs. 7 GyO-VO. */
export const GRADE_BY_POINTS = ['6', '5−', '5', '5+', '4−', '4', '4+', '3−', '3', '3+', '2−', '2', '2+', '1−', '1', '1+'] as const;

export function summarize(round: Round): RoundSummary {
  const answered = round.items.filter(isAnswered);
  const correct = answered.filter(isCorrect).length;
  const pct = answered.length ? Math.round((correct / answered.length) * 100) : 0;
  return {
    total: round.items.length,
    answered: answered.length,
    correct,
    pct,
    points: pctToPoints(pct),
    totalMs: answered.reduce((s, i) => s + (i.ms ?? 0), 0),
  };
}

export interface PickOptions {
  /** Unsichere und neue Fragen bevorzugen. */
  preferWeak?: boolean;
  stats?: StatsMap;
  rng?: Rng;
}

/**
 * Wählt n Fragen ohne Wiederholung. Mit `preferWeak` gewichtet (Efraimidis-Spirakis):
 * zuletzt falsch ×4, neu ×2, zuletzt richtig ×0,35.
 */
export function pickQuestions(pool: readonly Question[], n: number, opts: PickOptions = {}): Question[] {
  const rng = opts.rng ?? Math.random;
  const count = Math.max(0, Math.min(n, pool.length));
  if (!opts.preferWeak) return shuffle(pool, rng).slice(0, count);
  const stats = opts.stats ?? {};
  return pool
    .map(q => {
      const st = stats[q.id];
      const weight = !st ? 2 : st.lastCorrect ? 0.35 : 4;
      return { q, key: Math.pow(rng(), 1 / weight) };
    })
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .map(x => x.q);
}

/** Aktualisiert den Lernstand unveränderlich. */
export function recordStats(stats: StatsMap, questionId: string, correct: boolean): StatsMap {
  const prev = stats[questionId] ?? { right: 0, wrong: 0, lastCorrect: false };
  return {
    ...stats,
    [questionId]: {
      right: prev.right + (correct ? 1 : 0),
      wrong: prev.wrong + (correct ? 0 : 1),
      lastCorrect: correct,
    },
  };
}
