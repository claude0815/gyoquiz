import { describe, expect, it } from 'vitest';
import { catalogue, parseCatalogue, questionById } from '../src/catalogue';
import { answer } from '../src/engine';
import {
  LINK_ERROR_MESSAGES, buildLink, decodePayload, encodePayload, fromBase64Url, isValidName, normalizeName, parseHash,
  seal, toBase64Url, type DuelPayload, type DuelPlayer,
} from '../src/duel/link';
import { answerOrder, createDuelRound, msToTenths, playerFromRound, resultsOf } from '../src/duel/round';
import { compare, formatTenths, runningScore } from '../src/duel/score';
import { pickRematch, selectionLabel, selectionOf } from '../src/duel/selection';
import { MAX_STORED_DUELS, describeDuel, findDuel, sanitizeDuels, upsertDuel, type StoredDuel } from '../src/duel/store';

const IDS = catalogue.questions.slice(0, 10).map(q => q.id);
const player = (n: string, r: string, t?: number[]): DuelPlayer => ({ n, r, t: t ?? [...r].map(() => 50) });

function challenge(over: Partial<DuelPayload> = {}): DuelPayload {
  return seal({ v: 1, k: catalogue.version, id: 'ab12cd34', s: 123456789, q: IDS, a: player('Anke', '1101101101'), ...over });
}
const withB = (): DuelPayload => seal({ ...challenge(), b: player('Bernd Ü.', '1111100000', IDS.map((_, i) => i * 10)) });

describe('Link: Kodierung', () => {
  it('base64url ohne Padding und mit Umlauten', () => {
    const s = 'Jörg 🎓 / + =';
    const enc = toBase64Url(s);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromBase64Url(enc)).toBe(s);
  });

  it('Roundtrip Herausforderung', () => {
    const p = challenge();
    const r = decodePayload(encodePayload(p));
    expect(r).toEqual({ ok: true, payload: p });
  });

  it('Roundtrip Rückmeldung', () => {
    const p = withB();
    const r = decodePayload(encodePayload(p));
    expect(r).toEqual({ ok: true, payload: p });
  });

  it('baut Links mit Hash-Fragment und liest sie wieder', () => {
    const link = buildLink('https://example.org/gyoquiz/', 'd', challenge());
    expect(link).toMatch(/^https:\/\/example\.org\/gyoquiz\/#d=[A-Za-z0-9_-]+$/);
    const route = parseHash(new URL(link).hash);
    expect(route.kind).toBe('d');
    expect(route.kind !== 'none' && route.result.ok).toBe(true);
    expect(parseHash('').kind).toBe('none');
    expect(parseHash('#foo').kind).toBe('none');
  });

  it('verlangt b genau im Rückmelde-Link', () => {
    const d = parseHash(`#r=${encodePayload(challenge())}`);
    expect(d.kind !== 'none' && !d.result.ok && d.result.error).toBe('corrupt');
    const r = parseHash(`#d=${encodePayload(withB())}`);
    expect(r.kind !== 'none' && !r.result.ok && r.result.error).toBe('corrupt');
    const ok = parseHash(`#r=${encodePayload(withB())}`);
    expect(ok.kind !== 'none' && ok.result.ok).toBe(true);
  });

  it('bleibt mit 40 Fragen und langen Namen unter 2000 Zeichen', () => {
    const q = catalogue.questions.slice(-40).map(x => x.id);
    const long = 'Ä'.repeat(23) + '🎓';
    const p = seal({
      v: 1, k: catalogue.version, id: 'zz99zz99', s: 0xffffffff, q,
      a: player(long, '1'.repeat(40), q.map(() => 9999)),
      b: player(long, '0'.repeat(40), q.map(() => 9999)),
    });
    const link = buildLink('https://claude0815.github.io/gyoquiz/', 'r', p);
    expect(link.length).toBeLessThan(2000);
    expect(decodePayload(encodePayload(p)).ok).toBe(true);
  });
});

describe('Link: Prüfung', () => {
  const err = (data: string) => {
    const r = decodePayload(data);
    return r.ok ? 'ok' : r.error;
  };
  const raw = (obj: unknown) => toBase64Url(JSON.stringify(obj));

  it('erkennt ein geändertes Zeichen', () => {
    const enc = encodePayload(withB());
    let hits = 0;
    for (let i = 0; i < enc.length; i++) {
      const ch = enc[i] === 'A' ? 'B' : 'A';
      const changed = enc.slice(0, i) + ch + enc.slice(i + 1);
      if (err(changed) === 'corrupt') hits++;
    }
    expect(hits).toBe(enc.length);
  });

  it('erkennt einen abgeschnittenen Link', () => {
    const enc = encodePayload(challenge());
    for (const cut of [1, 2, 5, 20, Math.floor(enc.length / 2)]) expect(err(enc.slice(0, -cut))).toBe('corrupt');
    expect(err('')).toBe('corrupt');
    expect(err('%%%')).toBe('corrupt');
  });

  it('erkennt eine falsche Prüfsumme bei sonst gültigem JSON', () => {
    const p = challenge();
    expect(err(raw({ ...p, s: p.s + 1 }))).toBe('corrupt');
    expect(err(raw({ ...p, c: undefined }))).toBe('corrupt');
  });

  it('meldet neuere Linkversionen', () => {
    expect(err(raw({ ...challenge(), v: 2 }))).toBe('version');
    expect(err(raw({ ...challenge(), v: 'x' }))).toBe('corrupt');
  });

  it('meldet unbekannte Fragen-IDs', () => {
    const p = challenge({ q: [...IDS.slice(0, 9), 'g999'] });
    expect(err(encodePayload(p))).toBe('catalogue');
  });

  it('erkennt falsche Längen, doppelte IDs, ungültige Namen und Werte', () => {
    const bad: Array<Partial<DuelPayload>> = [
      { a: player('Anke', '110') },
      { a: { n: 'Anke', r: '1101101101', t: [1, 2, 3] } },
      { a: player('Anke', '11011011x1') },
      { a: player('Anke', '1101101101', IDS.map(() => 10000)) },
      { a: player('Anke', '1101101101', IDS.map(() => 1.5)) },
      { q: [...IDS.slice(0, 9), IDS[0]!] },
      { q: IDS.slice(0, 4), a: player('Anke', '1101') },
      { a: player('', '1101101101') },
      { a: player('   ', '1101101101') },
      { a: player(' Anke', '1101101101') },
      { a: player('x'.repeat(25), '1101101101') },
      { id: 'ABCDEFGH' },
      { id: 'abc' },
      { s: -1 },
      { s: 2 ** 32 },
    ];
    for (const over of bad) expect(err(encodePayload(challenge(over))), JSON.stringify(over)).toBe('corrupt');
    expect(err(encodePayload(challenge({ a: player('x'.repeat(24), '1101101101') })))).toBe('ok');
  });

  it('hat verständliche Meldungen', () => {
    expect(LINK_ERROR_MESSAGES.corrupt).toContain('beschädigt');
    expect(LINK_ERROR_MESSAGES.version).toContain('neueren Version');
    expect(LINK_ERROR_MESSAGES.catalogue).toContain('Fragenkatalog');
  });

  it('löst ausgemusterte Fragen auf', () => {
    // Alle Fragen inkl. ausgemusterter sind über questionById erreichbar …
    expect(questionById.size).toBe(catalogue.questions.length + catalogue.retired.length);
    for (const q of catalogue.retired) expect(questionById.get(q.id)).toBe(q);
    // … und ein Link mit einer ausgemusterten Frage wird angenommen.
    const frage = (id: string) => ({ id, abschnitt: 's', fundstelle: '§ 1', frage: 'F', richtig: 'r', falsch: ['a', 'b', 'c'], erklaerung: 'e' });
    const cat = parseCatalogue({
      katalog: { version: 1 }, verordnungen: [], abschnitte: [], glossar: [],
      fragen: ['g001', 'g002', 'g003', 'g004'].map(frage),
      ausgemustert: [frage('g000')],
    });
    const lookup = new Map([...cat.questions, ...cat.retired].map(q => [q.id, q]));
    const p = seal({ v: 1, k: 1, id: 'ab12cd34', s: 1, q: ['g001', 'g002', 'g000', 'g003', 'g004'], a: player('A', '10101') });
    expect(decodePayload(encodePayload(p), id => lookup.has(id)).ok).toBe(true);
    expect(decodePayload(encodePayload(p), id => cat.questions.some(q => q.id === id)).ok).toBe(false);
  });
});

describe('Namen', () => {
  it('normalisiert und prüft', () => {
    expect(normalizeName('  Frau   Meyer ')).toBe('Frau Meyer');
    expect(isValidName('Frau Meyer')).toBe(true);
    expect(isValidName('')).toBe(false);
    expect(isValidName('Ö'.repeat(24))).toBe(true);
    expect(isValidName('Ö'.repeat(25))).toBe(false);
  });
});

describe('Antwortreihenfolge', () => {
  it('ist je Frage eine Permutation von 0–3', () => {
    for (const id of IDS) expect([...answerOrder(42, id)].sort()).toEqual([0, 1, 2, 3]);
  });
  it('ist für beide Spieler gleich und unabhängig von der Position', () => {
    const qs = catalogue.questions.slice(0, 20);
    const a = createDuelRound(qs, 777);
    const b = createDuelRound([...qs].reverse(), 777);
    for (const it of a.items) expect(b.items.find(x => x.questionId === it.questionId)!.order).toEqual(it.order);
  });
  it('unterscheidet sich für verschiedene Seeds', () => {
    const qs = catalogue.questions.slice(0, 20);
    const a = createDuelRound(qs, 1).items.map(i => i.order.join(''));
    const b = createDuelRound(qs, 2).items.map(i => i.order.join(''));
    expect(a).not.toEqual(b);
  });
});

describe('Ergebnis aus einer Runde', () => {
  it('rechnet Zeiten in Zehntel, offene Fragen sind falsch mit Höchstzeit', () => {
    const qs = catalogue.questions.slice(0, 5);
    const round = createDuelRound(qs, 5);
    answer(round.items[0]!, round.items[0]!.order.indexOf(0), 12_345);
    answer(round.items[1]!, round.items[1]!.order.indexOf(1), 2_000_000);
    expect(playerFromRound('A', round)).toEqual({ n: 'A', r: '10000', t: [123, 9999, 9999, 9999, 9999] });
    expect(resultsOf(round)).toEqual([true, false, null, null, null]);
    expect(msToTenths(-5)).toBe(0);
    expect(msToTenths(49)).toBe(0);
    expect(msToTenths(50)).toBe(1);
  });
});

describe('Wertung', () => {
  it('mehr richtige gewinnt', () => {
    const c = compare(player('B', '11100', [900, 900, 900, 900, 900]), player('A', '11000', [1, 1, 1, 1, 1]));
    expect(c).toMatchObject({ outcome: 'win', myCorrect: 3, otherCorrect: 2 });
  });
  it('bei Gleichstand gewinnt die kürzere Gesamtzeit', () => {
    const c = compare(player('B', '11000', [10, 10, 10, 10, 10]), player('A', '00011', [20, 20, 20, 20, 22]));
    expect(c).toEqual({ outcome: 'win', myCorrect: 2, otherCorrect: 2, timeDiffTenths: 52 });
  });
  it('exakt gleiche Zeit ist unentschieden', () => {
    expect(compare(player('B', '10100', [1, 2, 3, 4, 5]), player('A', '01010', [5, 4, 3, 2, 1])).outcome).toBe('draw');
  });
  it('Sicht von A und B ist spiegelbildlich', () => {
    const pairs: Array<[DuelPlayer, DuelPlayer]> = [
      [player('A', '11100'), player('B', '11000')],
      [player('A', '11000', [1, 1, 1, 1, 1]), player('B', '00011', [2, 2, 2, 2, 2])],
      [player('A', '11000'), player('B', '00011')],
    ];
    const mirror = { win: 'loss', loss: 'win', draw: 'draw' } as const;
    for (const [a, b] of pairs) {
      const ab = compare(a, b), ba = compare(b, a);
      expect(ba.outcome).toBe(mirror[ab.outcome]);
      expect(ba.myCorrect).toBe(ab.otherCorrect);
      expect(ba.timeDiffTenths).toBe(0 - ab.timeDiffTenths);
    }
  });
  it('zählt den laufenden Spielstand nur bis zur aktuellen Frage', () => {
    const other = player('A', '11011');
    expect(runningScore([true, false, null, null, null], other, 1)).toEqual({ me: 1, other: 2 });
    expect(runningScore([true, false, true, null, null], other, 2)).toEqual({ me: 2, other: 2 });
    expect(runningScore([true, false, true, true, true], other, 4)).toEqual({ me: 4, other: 4 });
  });
  it('formatiert Zeiten deutsch', () => {
    expect(formatTenths(412)).toBe('41,2 s');
    expect(formatTenths(5)).toBe('0,5 s');
  });
});

describe('Auswahl', () => {
  it('leitet die Auswahl aus den Fragen ab', () => {
    const qs = catalogue.questions.filter(q => q.section === 'gyo-versetzung').slice(0, 5).map(q => q.id);
    const sel = selectionOf(qs);
    expect(sel.regulations).toEqual(['GyO-VO']);
    expect(selectionLabel(sel)).toMatch(/^GyO-VO, 1 Abschnitt/);
    const mixed = selectionOf([...qs, catalogue.questions.find(q => q.id.startsWith('a'))!.id]);
    expect(selectionLabel(mixed)).toMatch(/^GyO-VO und AP-V, 2 Abschnitte/);
  });
  it('wählt für die Revanche neue Fragen aus derselben Auswahl', () => {
    const prev = catalogue.questions.slice(0, 10).map(q => q.id);
    const sel = selectionOf(prev);
    const next = pickRematch(sel, prev, 10);
    expect(next).toHaveLength(10);
    for (const q of next) expect(sel.sectionIds).toContain(q.section);
    const fresh = next.filter(q => !prev.includes(q.id)).length;
    const available = catalogue.questions.filter(q => sel.sectionIds.includes(q.section) && !prev.includes(q.id)).length;
    expect(fresh).toBe(Math.min(10, available));
  });
});

describe('Lokale Duelle', () => {
  const stored = (id: string, extra: Partial<StoredDuel> = {}): StoredDuel => ({
    id, role: 'challenger', payload: challenge({ id }), ...extra,
  });
  it('ersetzt vorhandene Einträge und stellt sie nach vorn', () => {
    let list = upsertDuel([], stored('aaaaaaaa'));
    list = upsertDuel(list, stored('bbbbbbbb'));
    list = upsertDuel(list, stored('aaaaaaaa', { finishedAt: 'x' }));
    expect(list.map(d => d.id)).toEqual(['aaaaaaaa', 'bbbbbbbb']);
    expect(findDuel(list, 'aaaaaaaa')?.finishedAt).toBe('x');
  });
  it('speichert höchstens 50 und verwirft die ältesten', () => {
    let list: StoredDuel[] = [];
    for (let i = 0; i < 60; i++) list = upsertDuel(list, stored(`id${String(i).padStart(6, '0')}`));
    expect(list).toHaveLength(MAX_STORED_DUELS);
    expect(findDuel(list, 'id000000')).toBeUndefined();
    expect(list[0]!.id).toBe('id000059');
  });
  it('verwirft unbrauchbare gespeicherte Daten', () => {
    expect(sanitizeDuels(null)).toEqual([]);
    expect(sanitizeDuels([{ id: 1 }, stored('aaaaaaaa')])).toHaveLength(1);
  });
  it('beschreibt den Stand', () => {
    expect(describeDuel(stored('aaaaaaaa'))).toEqual({ opponent: null, status: 'wartet auf Rückmeldung', kind: 'd' });
    const done = { ...stored('ab12cd34'), payload: withB() };
    expect(describeDuel(done)).toEqual({ opponent: 'Bernd Ü.', status: 'gewonnen 7 : 5', kind: 'r' });
    expect(describeDuel({ ...done, role: 'opponent' })).toEqual({ opponent: 'Anke', status: 'verloren 5 : 7', kind: 'd' });
  });
});
