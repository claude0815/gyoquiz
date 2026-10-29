/**
 * Kleiner Wrapper um localStorage. Privatmodus oder blockierte Website-Daten
 * dürfen die App nie zum Absturz bringen; dann gibt es eben keinen Lernstand.
 */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Speicher nicht verfügbar: still ignorieren */
  }
}

export const KEYS = {
  stats: 'gyoquiz:stats:v1',
  settings: 'gyoquiz:settings:v1',
  duels: 'gyoquiz:duels:v1',
  /** Vorbelegung für das Namensfeld im Duell. */
  name: 'gyoquiz:name:v1',
  /** Laufendes eigenes Duell, bevor der Link existiert. */
  duelDraft: 'gyoquiz:duel-draft:v1',
} as const;
