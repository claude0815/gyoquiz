import { describe, expect, it } from 'vitest';
import type { Question } from '../src/catalogue';
import {
  GRADE_BY_POINTS, answer, createRound, isCorrect, pctToPoints, pickQuestions, recordStats, summarize, type StatsMap,
} from '../src/engine';
import { hashString, seededRng, shuffle } from '../src/rng';

const q = (id: string): Question => ({
  id, section: 's', ref: '§ 1', isCase: false, text: `Frage ${id}`, correct: 'r', wrong: ['a', 'b', 'c'], explanation: 'e',
});
const POOL = Array.from({ length: 50 }, (_, i) => q(`g${String(i + 1).padStart(3, '0')}`));

describe('Notenpunkte', () => {
  it.each([[100, 15], [95, 15], [94, 14], [50, 6], [45, 5], [44, 4], [33, 3], [20, 1], [19, 0], [0, 0]])('%i %% → %i Punkte', (pct, pts) => {
    expect(pctToPoints(pct)).toBe(pts);
  });
  it('ordnet Punkten die Note nach § 12 Abs. 7 GyO-VO zu', () => {
    expect(GRADE_BY_POINTS[15]).toBe('1+');
    expect(GRADE_BY_POINTS[10]).toBe('2−');
    expect(GRADE_BY_POINTS[5]).toBe('4');
    expect(GRADE_BY_POINTS[0]).toBe('6');
  });
});

describe('Zufall', () => {
  it('liefert mit gleichem Seed die gleiche Folge', () => {
    const a = seededRng(42), b = seededRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('mischt deterministisch und vollständig', () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7];
    const s1 = shuffle(items, seededRng(7));
    expect(shuffle(items, seededRng(7))).toEqual(s1);
    expect([...s1].sort()).toEqual(items);
    expect(items).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('hasht stabil', () => {
    expect(hashString('g001')).toBe(hashString('g001'));
    expect(hashString('g001')).not.toBe(hashString('g002'));
  });
});

describe('Fragenauswahl', () => {
  it('wählt n verschiedene Fragen', () => {
    const picked = pickQuestions(POOL, 20, { rng: seededRng(1) });
    expect(picked).toHaveLength(20);
    expect(new Set(picked.map(x => x.id)).size).toBe(20);
  });
  it('begrenzt auf die Poolgröße', () => {
    expect(pickQuestions(POOL.slice(0, 5), 20)).toHaveLength(5);
  });
  it('bevorzugt zuletzt falsch beantwortete Fragen', () => {
    const stats: StatsMap = {};
    POOL.slice(0, 25).forEach(x => { stats[x.id] = { right: 3, wrong: 0, lastCorrect: true }; });
    POOL.slice(25).forEach(x => { stats[x.id] = { right: 0, wrong: 1, lastCorrect: false }; });
    const rng = seededRng(99);
    let weak = 0;
    for (let i = 0; i < 200; i++) {
      weak += pickQuestions(POOL, 10, { preferWeak: true, stats, rng }).filter(x => !stats[x.id]!.lastCorrect).length;
    }
    expect(weak / 2000).toBeGreaterThan(0.75);
  });
});

describe('Runde', () => {
  it('zählt richtige Antworten und Zeiten', () => {
    const round = createRound(POOL.slice(0, 3), () => [2, 0, 1, 3]);
    expect(answer(round.items[0]!, 1, 1200)).toBe(true); // Position 1 → Index 0 = richtig
    expect(answer(round.items[1]!, 0, 800)).toBe(true); // Position 0 → Index 2 = falsch
    expect(answer(round.items[1]!, 1, 50)).toBe(false); // schon beantwortet
    expect(isCorrect(round.items[0]!)).toBe(true);
    expect(isCorrect(round.items[1]!)).toBe(false);
    const s = summarize(round);
    expect(s).toMatchObject({ total: 3, answered: 2, correct: 1, pct: 50, points: 6, totalMs: 2000 });
  });
  it('lehnt ungültige Positionen ab', () => {
    const round = createRound(POOL.slice(0, 1));
    expect(() => answer(round.items[0]!, 4, 0)).toThrow(RangeError);
  });
});

describe('Lernstand', () => {
  it('aktualisiert unveränderlich', () => {
    const before: StatsMap = {};
    const after = recordStats(before, 'g001', false);
    expect(before).toEqual({});
    expect(after.g001).toEqual({ right: 0, wrong: 1, lastCorrect: false });
    expect(recordStats(after, 'g001', true).g001).toEqual({ right: 1, wrong: 1, lastCorrect: true });
  });
});
