import type { Round } from '../engine';
import { KEYS, load, save } from '../storage';
import type { DuelPayload } from './link';
import { compare } from './score';

export interface StoredDuel {
  id: string;
  role: 'challenger' | 'opponent';
  /** Zuletzt bekannter Stand (mit b, sobald vorhanden). */
  payload: DuelPayload;
  /** Laufende Runde, damit Neuladen nicht alles verliert. */
  inProgress?: Round;
  /** ISO-Zeitstempel. */
  finishedAt?: string;
}

export const MAX_STORED_DUELS = 50;

/** Fügt ein Duell vorne ein bzw. ersetzt es; bei mehr als 50 fallen die ältesten weg. */
export function upsertDuel(list: readonly StoredDuel[], duel: StoredDuel): StoredDuel[] {
  return [duel, ...list.filter(d => d.id !== duel.id)].slice(0, MAX_STORED_DUELS);
}

export function findDuel(list: readonly StoredDuel[], id: string): StoredDuel | undefined {
  return list.find(d => d.id === id);
}

/** Grobe Prüfung gespeicherter Daten; Unbrauchbares wird verworfen. */
export function sanitizeDuels(raw: unknown): StoredDuel[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((d): d is StoredDuel =>
    typeof d === 'object' && d !== null &&
    typeof d.id === 'string' && (d.role === 'challenger' || d.role === 'opponent') &&
    typeof d.payload === 'object' && d.payload !== null && d.payload.id === d.id && Array.isArray(d.payload.q) &&
    typeof d.payload.a?.n === 'string',
  ).slice(0, MAX_STORED_DUELS);
}

export function loadDuels(): StoredDuel[] {
  return sanitizeDuels(load<unknown>(KEYS.duels, []));
}

export function saveDuels(list: readonly StoredDuel[]): void {
  save(KEYS.duels, list);
}

export interface DuelListEntry {
  /** Name des Gegners, falls bekannt. */
  opponent: string | null;
  status: string;
  /** Welcher Link das Duell wieder öffnet. */
  kind: 'd' | 'r';
}

/** Kurzbeschreibung für „Meine Duelle“. */
export function describeDuel(d: StoredDuel): DuelListEntry {
  const { a, b } = d.payload;
  if (d.role === 'challenger') {
    if (!b) return { opponent: null, status: 'wartet auf Rückmeldung', kind: 'd' };
    return { opponent: b.n, status: outcomeText(compare(a, b)), kind: 'r' };
  }
  if (!b) return { opponent: a.n, status: d.inProgress ? 'läuft noch' : 'noch nicht gespielt', kind: 'd' };
  return { opponent: a.n, status: outcomeText(compare(b, a)), kind: 'd' };
}

function outcomeText(c: ReturnType<typeof compare>): string {
  const word = c.outcome === 'win' ? 'gewonnen' : c.outcome === 'loss' ? 'verloren' : 'unentschieden';
  return `${word} ${c.myCorrect} : ${c.otherCorrect}`;
}
