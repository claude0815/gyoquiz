import { describe, expect, it } from 'vitest';
import { catalogue, paragraphKey, parseCatalogue, questionById, sectionById } from '../src/catalogue';

describe('Fragenkatalog', () => {
  it('hat eine ganzzahlige Katalogversion', () => {
    expect(Number.isInteger(catalogue.version)).toBe(true);
    expect(catalogue.version).toBeGreaterThanOrEqual(1);
  });

  it('hat eindeutige IDs im Format g001 / a001 passend zur Verordnung, auch über ausgemusterte Fragen hinweg', () => {
    const ids = [...catalogue.questions, ...catalogue.retired].map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of catalogue.questions) {
      expect(q.id).toMatch(/^[ga]\d{3}$/);
      const reg = sectionById.get(q.section)?.regulation;
      expect(q.id.startsWith(reg === 'GyO-VO' ? 'g' : 'a'), `${q.id} passt nicht zu ${reg}`).toBe(true);
    }
  });

  it('ordnet jede Frage einem bekannten Abschnitt zu', () => {
    for (const q of catalogue.questions) expect(sectionById.has(q.section), q.id).toBe(true);
  });

  it('hat je Frage vier verschiedene, nicht leere Antworten', () => {
    for (const q of catalogue.questions) {
      const all = [q.correct, ...q.wrong].map(s => s.trim());
      expect(all.every(Boolean), q.id).toBe(true);
      expect(new Set(all).size, `${q.id}: doppelte Antwort`).toBe(4);
    }
  });

  it('hält ausgemusterte Fragen für alte Duell-Links auffindbar, aber aus neuen Runden heraus', () => {
    const active = new Set(catalogue.questions.map(q => q.id));
    for (const q of catalogue.retired) {
      expect(active.has(q.id), q.id).toBe(false);
      expect(questionById.get(q.id), q.id).toBe(q);
    }
  });

  it('hat keine doppelten Fragetexte', () => {
    const texts = catalogue.questions.map(q => q.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('deckt jeden Paragraphen und jede Anlage beider Verordnungen ab', () => {
    const missing: string[] = [];
    for (const s of catalogue.sections) {
      for (const p of s.paragraphs) {
        const n = catalogue.questions.filter(q => q.section === s.id && paragraphKey(q.ref) === p).length;
        if (n === 0) missing.push(`${s.regulation} ${p}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('verweist in jeder Frage auf einen Paragraphen ihres Abschnitts', () => {
    for (const q of catalogue.questions) {
      const key = paragraphKey(q.ref);
      expect(key, `${q.id}: Fundstelle "${q.ref}"`).not.toBeNull();
      expect(sectionById.get(q.section)!.paragraphs, `${q.id}: ${key}`).toContain(key);
    }
  });

  it('nutzt keine unerklärten Abkürzungen', () => {
    const re = /\b(JWS|PF|AF|MSA)\b/;
    for (const q of catalogue.questions) {
      for (const s of [q.text, q.correct, ...q.wrong, q.explanation]) expect(re.test(s), `${q.id}: ${s}`).toBe(false);
    }
  });

  it('hat ein Glossar und Quellen zu beiden Verordnungen', () => {
    expect(catalogue.glossary.length).toBeGreaterThan(5);
    expect(catalogue.regulations.map(r => r.short).sort()).toEqual(['AP-V', 'GyO-VO']);
  });

  it('lehnt eine Frage mit falscher Anzahl an Ablenkern ab', () => {
    const bad = {
      katalog: { version: 1 },
      verordnungen: [],
      abschnitte: [],
      glossar: [],
      fragen: [{ id: 'g999', abschnitt: 'x', fundstelle: '§ 1', frage: 'F?', richtig: 'A', falsch: ['B', 'C'], erklaerung: 'E' }],
    };
    expect(() => parseCatalogue(bad)).toThrow(/drei falsche/);
  });
});

describe('paragraphKey', () => {
  it.each([
    ['§ 16 Abs. 1 Nr. 3', '§ 16'],
    ['§ 10a Abs. 2', '§ 10a'],
    ['Anlage 1, Tab. 2', 'Anlage 1'],
    ['Anlage 1a', 'Anlage 1a'],
    ['§ 18 und Anlage 3', '§ 18'],
  ])('%s → %s', (ref, key) => {
    expect(paragraphKey(ref)).toBe(key);
  });
});
