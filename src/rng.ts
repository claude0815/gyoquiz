/** Zufallszahlen-Quelle: liefert Werte in [0, 1). */
export type Rng = () => number;

/** Deterministischer Zufallsgenerator (mulberry32). Gleicher Seed, gleiche Folge. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-Bit-Hash (FNV-1a) eines Strings, z. B. um aus Seed und Fragen-ID einen eigenen Seed abzuleiten. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Neuer, zufälliger 32-Bit-Seed. */
export function randomSeed(): number {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    return crypto.getRandomValues(new Uint32Array(1))[0]! >>> 0;
  }
  return Math.floor(Math.random() * 2 ** 32) >>> 0;
}

/** Fisher-Yates-Mischung; gibt eine neue Liste zurück. */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
