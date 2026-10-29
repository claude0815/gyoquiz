import { describe, expect, it } from 'vitest';
import { questionById } from '../src/catalogue';

/**
 * Rechnet die Antworten ausgewählter Fall- und Rechenfragen unabhängig nach,
 * mit den Formeln, die hinter den Tabellen der Anlagen stehen.
 * Schlägt ein Test fehl, ist entweder die Frage oder die Formel falsch: im Verordnungstext nachsehen.
 */

/** Anlage 3 AP-V: Durchschnittsnote aus Gesamtpunktzahl (300–900), N = 17/3 − E/180, auf eine Stelle abgeschnitten. */
function abiturNote(points: number): string {
  if (points >= 823) return '1,0';
  const n = Math.floor((17 / 3 - points / 180) * 10 + 1e-9) / 10;
  return n.toFixed(1).replace('.', ',');
}

/** Anlage 4 GyO-VO: Durchschnittsnote schulischer Teil FHR (95–285), N = 17/3 − E/57. */
function fhrNote(points: number): string {
  if (points >= 261) return '1,0';
  const n = Math.floor((17 / 3 - points / 57) * 10 + 1e-9) / 10;
  return n.toFixed(1).replace('.', ',');
}

/** Anlage 2 AP-V: schriftlich und zusätzlich mündlich im Verhältnis 2:1, mal Wertungsfaktor, gerundet. */
function anlage2(written: number, oral: number, factor: 4 | 5): number {
  return Math.round(((2 * written + oral) / 3) * factor);
}

const correct = (id: string): string => {
  const q = questionById.get(id);
  if (!q) throw new Error(`Frage ${id} fehlt`);
  return q.correct;
};

describe('Formeln stimmen mit den Tabellen überein', () => {
  it.each([[900, '1,0'], [823, '1,0'], [822, '1,1'], [643, '2,0'], [642, '2,1'], [553, '2,5'], [301, '3,9'], [300, '4,0']])(
    'Anlage 3: %i Punkte → %s', (p, n) => expect(abiturNote(p)).toBe(n),
  );
  it.each([[285, '1,0'], [261, '1,0'], [260, '1,1'], [204, '2,0'], [147, '3,0'], [96, '3,9'], [95, '4,0']])(
    'Anlage 4: %i Punkte → %s', (p, n) => expect(fhrNote(p)).toBe(n),
  );
  it.each([[9, 12, 5, 50], [1, 0, 5, 3], [0, 1, 5, 2], [15, 15, 5, 75], [1, 0, 4, 3], [15, 15, 4, 60]])(
    'Anlage 2: schriftlich %i, mündlich %i, Faktor %i → %i', (w, o, f, r) => expect(anlage2(w, o, f as 4 | 5)).toBe(r),
  );
});

describe('Antworten der Rechenfragen', () => {
  it('Anlage 2 AP-V', () => {
    expect(correct('a223')).toBe(String(anlage2(9, 12, 5)));
    expect(correct('a224')).toBe(String(anlage2(6, 12, 5)));
    expect(correct('a225')).toBe(String(anlage2(3, 9, 5)));
    expect(correct('a226')).toBe(String(anlage2(15, 15, 4)));
  });
  it('Anlage 3 AP-V', () => {
    expect(correct('a227')).toBe(abiturNote(650));
    expect(correct('a230')).toBe(abiturNote(700));
    expect(correct('a232')).toBe(abiturNote(380 + 195));
    expect(abiturNote(Number(correct('a231')))).toBe('2,5');
    expect(abiturNote(Number(correct('a231')) - 1)).toBe('2,6');
  });
  it('Anlage 4 GyO-VO', () => {
    expect(correct('g164')).toBe(fhrNote(206));
    expect(correct('g165')).toBe(fhrNote(150));
  });
  it('Block I und Block II', () => {
    expect(correct('a054')).toBe(String(9.5 * 40));
    expect(correct('a176')).toBe(String((10 + 8 + 7 + 11) * 5));
    expect(correct('a053')).toBe(String(24 + 6 * 2 + 2 + 2));
  });
});
