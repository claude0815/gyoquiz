import raw from '../content/fragen.yaml';

/** Kürzel der beiden Verordnungen. */
export type Regulation = 'GyO-VO' | 'AP-V';

export interface RegulationInfo {
  short: Regulation;
  title: string;
  dated: string;
  version: string;
  source: string;
}

export interface Section {
  id: string;
  regulation: Regulation;
  name: string;
  range: string;
  /** Paragraphen und Anlagen, die dieser Abschnitt abdeckt (für die Abdeckungsprüfung). */
  paragraphs: string[];
}

export interface Question {
  /** Stabile ID (g001…, a001…). Wird nie geändert oder neu vergeben. */
  id: string;
  section: string;
  /** Fundstelle, z. B. "§ 16 Abs. 1 Nr. 3". */
  ref: string;
  /** Fall- oder Rechenfrage. */
  isCase: boolean;
  text: string;
  correct: string;
  wrong: [string, string, string];
  explanation: string;
}

export interface GlossaryEntry {
  term: string;
  explanation: string;
}

export interface Catalogue {
  version: number;
  updated: string;
  regulations: RegulationInfo[];
  sections: Section[];
  glossary: GlossaryEntry[];
  /** Aktive Fragen für neue Runden. */
  questions: Question[];
  /** Ausgemusterte Fragen: nur noch für alte Duell-Links per ID abrufbar, nie in neuen Runden. */
  retired: Question[];
}

type Obj = Record<string, unknown>;

function obj(v: unknown, where: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`Fragenkatalog: ${where} ist kein Objekt`);
  return v as Obj;
}
function str(o: Obj, key: string, where: string): string {
  const v = o[key];
  // Ganze Zahlen ohne Anführungszeichen (richtig: 40) sind erlaubt; Kommazahlen schreibt der Katalog als "2,4".
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`Fragenkatalog: ${where}.${key} fehlt oder ist leer`);
  return v;
}
function list(o: Obj, key: string, where: string): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) throw new Error(`Fragenkatalog: ${where}.${key} ist keine Liste`);
  return v;
}

/** Wandelt die YAML-Struktur (deutsche Schlüssel) in typisierte Objekte um und prüft die Grundform. */
export function parseCatalogue(input: unknown): Catalogue {
  const root = obj(input, 'Wurzel');
  const meta = obj(root.katalog, 'katalog');
  const version = meta.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) throw new Error('Fragenkatalog: katalog.version muss eine ganze Zahl sein');

  const regulations = list(root, 'verordnungen', 'Wurzel').map((r, i): RegulationInfo => {
    const o = obj(r, `verordnungen[${i}]`);
    const short = str(o, 'kurz', `verordnungen[${i}]`);
    if (short !== 'GyO-VO' && short !== 'AP-V') throw new Error(`Fragenkatalog: unbekannte Verordnung ${short}`);
    return { short, title: str(o, 'titel', short), dated: str(o, 'vom', short), version: str(o, 'fassung', short), source: str(o, 'quelle', short) };
  });

  const sections = list(root, 'abschnitte', 'Wurzel').map((s, i): Section => {
    const o = obj(s, `abschnitte[${i}]`);
    const regulation = str(o, 'verordnung', `abschnitte[${i}]`);
    if (regulation !== 'GyO-VO' && regulation !== 'AP-V') throw new Error(`Fragenkatalog: abschnitte[${i}] hat unbekannte Verordnung`);
    return {
      id: str(o, 'id', `abschnitte[${i}]`),
      regulation,
      name: str(o, 'name', `abschnitte[${i}]`),
      range: str(o, 'bereich', `abschnitte[${i}]`),
      paragraphs: list(o, 'paragraphen', `abschnitte[${i}]`).map(String),
    };
  });

  const glossary = list(root, 'glossar', 'Wurzel').map((g, i): GlossaryEntry => {
    const o = obj(g, `glossar[${i}]`);
    return { term: str(o, 'begriff', `glossar[${i}]`), explanation: str(o, 'erklaerung', `glossar[${i}]`) };
  });

  const parseQuestion = (q: unknown, where: string): Question => {
    const o = obj(q, where);
    const id = str(o, 'id', where);
    const wrong = list(o, 'falsch', id).map(String);
    if (wrong.length !== 3) throw new Error(`Fragenkatalog: ${id} braucht genau drei falsche Antworten`);
    return {
      id,
      section: str(o, 'abschnitt', id),
      ref: str(o, 'fundstelle', id),
      isCase: o.fall === true,
      text: str(o, 'frage', id),
      correct: str(o, 'richtig', id),
      wrong: wrong as [string, string, string],
      explanation: str(o, 'erklaerung', id),
    };
  };
  const questions = list(root, 'fragen', 'Wurzel').map((q, i) => parseQuestion(q, `fragen[${i}]`));
  const retired = (Array.isArray(root.ausgemustert) ? root.ausgemustert : []).map((q, i) => parseQuestion(q, `ausgemustert[${i}]`));

  return { version, updated: String(meta.stand ?? ''), regulations, sections, glossary, questions, retired };
}

export const catalogue: Catalogue = parseCatalogue(raw);
export const sectionById: ReadonlyMap<string, Section> = new Map(catalogue.sections.map(s => [s.id, s]));
/** Alle Fragen einschließlich ausgemusterter, z. B. um alte Duell-Links aufzulösen. */
export const questionById: ReadonlyMap<string, Question> = new Map(
  [...catalogue.questions, ...catalogue.retired].map(q => [q.id, q]),
);

/** Paragraph oder Anlage einer Fundstelle: "§ 16 Abs. 1 Nr. 3" → "§ 16", "Anlage 1, Tab. 2" → "Anlage 1". */
export function paragraphKey(ref: string): string | null {
  const m = ref.match(/^(§\s?\d+[a-z]?|Anlage\s\d+[a-z]?)/);
  return m ? m[1]!.replace(/\s+/, ' ') : null;
}

export function regulationOf(q: Question): Regulation {
  const s = sectionById.get(q.section);
  if (!s) throw new Error(`Unbekannter Abschnitt ${q.section}`);
  return s.regulation;
}
