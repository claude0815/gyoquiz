import { catalogue, questionById, sectionById, type Question, type Regulation } from '../catalogue';
import { pickQuestions } from '../engine';
import type { Rng } from '../rng';

/** Auswahl eines Duells, abgeleitet aus seinen Fragen (der Link enthält keine Einstellungen). */
export interface DuelSelection {
  regulations: Regulation[];
  sectionIds: string[];
  casesOnly: boolean;
}

export function selectionOf(questionIds: readonly string[], lookup: ReadonlyMap<string, Question> = questionById): DuelSelection {
  const qs = questionIds.map(id => lookup.get(id)).filter((q): q is Question => q !== undefined);
  const sectionIds = [...new Set(qs.map(q => q.section))];
  const regs = new Set(sectionIds.map(id => sectionById.get(id)?.regulation));
  return {
    regulations: catalogue.regulations.map(r => r.short).filter(r => regs.has(r)),
    sectionIds,
    casesOnly: qs.length > 0 && qs.every(q => q.isCase),
  };
}

/** Aufzählung wie „A, B und C“. */
function joinGerman(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} und ${items[items.length - 1]}`;
}

/** Kurzform wie „GyO-VO und AP-V, 14 Abschnitte“. */
export function selectionLabel(sel: DuelSelection): string {
  const n = sel.sectionIds.length;
  return `${joinGerman(sel.regulations)}, ${n} ${n === 1 ? 'Abschnitt' : 'Abschnitte'}${sel.casesOnly ? ', nur Fall- und Rechenfragen' : ''}`;
}

/** Fragen für eine Revanche: dieselbe Auswahl, möglichst keine Frage aus dem letzten Duell. */
export function pickRematch(sel: DuelSelection, previous: readonly string[], n: number, rng?: Rng): Question[] {
  const sections = new Set(sel.sectionIds);
  const pool = catalogue.questions.filter(q => sections.has(q.section) && (!sel.casesOnly || q.isCase));
  const used = new Set(previous);
  const fresh = pickQuestions(pool.filter(q => !used.has(q.id)), n, { rng });
  if (fresh.length >= n) return fresh;
  return [...fresh, ...pickQuestions(pool.filter(q => used.has(q.id)), n - fresh.length, { rng })];
}
