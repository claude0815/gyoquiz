import { questionById } from '../catalogue';
import { hashString } from '../rng';

/** Version des Linkformats. */
export const LINK_VERSION = 1;
export const NAME_MAX = 24;
export const MIN_QUESTIONS = 5;
export const MAX_QUESTIONS = 40;
/** Höchstzeit je Frage in Zehntelsekunden (999,9 s). */
export const MAX_TENTHS = 9999;

export interface DuelPlayer {
  /** Name, 1–24 Zeichen. */
  n: string;
  /** Ergebnis je Frage: "1" richtig, "0" falsch. Länge = q.length. */
  r: string;
  /** Antwortzeit je Frage in Zehntelsekunden, ganzzahlig, 0–9999. */
  t: number[];
}

export interface DuelPayload {
  v: 1;
  /** katalog.version beim Erstellen (nur zur Information). */
  k: number;
  /** Duell-ID, 8 Zeichen [a-z0-9]. */
  id: string;
  /** Seed (uint32) für die Antwortreihenfolge. */
  s: number;
  /** Fragen-IDs in Spielreihenfolge. */
  q: string[];
  a: DuelPlayer;
  /** Nur im Rückmelde-Link. */
  b?: DuelPlayer;
  /** Prüfsumme über alle anderen Felder. */
  c: string;
}

export type UnsealedPayload = Omit<DuelPayload, 'c'>;
export type LinkKind = 'd' | 'r';
export type LinkError = 'corrupt' | 'version' | 'catalogue';

export const LINK_ERROR_MESSAGES: Record<LinkError, string> = {
  corrupt: 'Der Link ist unvollständig oder beschädigt. Bitte den ganzen Link erneut kopieren.',
  version: 'Dieser Link stammt aus einer neueren Version. Bitte die Seite neu laden.',
  catalogue: 'Dieser Link passt nicht zum aktuellen Fragenkatalog.',
};

export type DecodeResult =
  | { ok: true; payload: DuelPayload }
  | { ok: false; error: LinkError; message: string };

const fail = (error: LinkError): DecodeResult => ({ ok: false, error, message: LINK_ERROR_MESSAGES[error] });

/* ---------- Namen ---------- */

/** Länge in Zeichen (Codepoints), damit Umlaute und Emoji als ein Zeichen zählen. */
const charLength = (s: string): number => [...s].length;

export function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

export function isValidName(n: unknown): n is string {
  return typeof n === 'string' && n === normalizeName(n) && charLength(n) >= 1 && charLength(n) <= NAME_MAX;
}

/* ---------- base64url ---------- */

export function toBase64Url(text: string): string {
  let bin = '';
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Wirft bei ungültigem base64url oder ungültigem UTF-8. */
export function fromBase64Url(data: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(data)) throw new Error('Kein base64url');
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (data.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/* ---------- Kodierung ---------- */

const canonicalPlayer = (p: DuelPlayer): DuelPlayer => ({ n: p.n, r: p.r, t: p.t });

/** Feste Schlüsselreihenfolge, damit Prüfsumme und Link nicht von der Objekt-Entstehung abhängen. */
function canonical(p: UnsealedPayload): UnsealedPayload {
  const out: UnsealedPayload = { v: p.v, k: p.k, id: p.id, s: p.s, q: p.q, a: canonicalPlayer(p.a) };
  if (p.b) out.b = canonicalPlayer(p.b);
  return out;
}

export function checksum(p: UnsealedPayload): string {
  return hashString(JSON.stringify(canonical(p))).toString(36).slice(0, 6);
}

/** Ergänzt die Prüfsumme. */
export function seal(p: UnsealedPayload): DuelPayload {
  return { ...canonical(p), c: checksum(p) };
}

export function encodePayload(p: DuelPayload): string {
  return toBase64Url(JSON.stringify({ ...canonical(p), c: checksum(p) }));
}

export function buildLink(base: string, kind: LinkKind, p: DuelPayload): string {
  return `${base}#${kind}=${encodePayload(p)}`;
}

/* ---------- Prüfung ---------- */

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

function isPlayer(x: unknown, len: number): x is DuelPlayer {
  if (!isObj(x) || !isValidName(x.n)) return false;
  if (typeof x.r !== 'string' || x.r.length !== len || !/^[01]*$/.test(x.r)) return false;
  return Array.isArray(x.t) && x.t.length === len && x.t.every(v => Number.isInteger(v) && v >= 0 && v <= MAX_TENTHS);
}

function isWellFormed(x: Obj): boolean {
  if (!Number.isInteger(x.k)) return false;
  if (typeof x.id !== 'string' || !/^[a-z0-9]{8}$/.test(x.id)) return false;
  if (!Number.isInteger(x.s) || (x.s as number) < 0 || (x.s as number) > 0xffffffff) return false;
  const q = x.q;
  if (!Array.isArray(q) || q.length < MIN_QUESTIONS || q.length > MAX_QUESTIONS) return false;
  if (!q.every(id => typeof id === 'string' && id.length > 0) || new Set(q).size !== q.length) return false;
  if (!isPlayer(x.a, q.length)) return false;
  return x.b === undefined || isPlayer(x.b, q.length);
}

/**
 * Liest einen Payload ein und prüft ihn vollständig. Wirft nie.
 * `hasQuestion` prüft Fragen-IDs; ausgemusterte Fragen zählen als bekannt.
 */
export function decodePayload(data: string, hasQuestion: (id: string) => boolean = id => questionById.has(id)): DecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(data));
  } catch {
    return fail('corrupt');
  }
  if (!isObj(parsed)) return fail('corrupt');
  if (parsed.v !== LINK_VERSION) return typeof parsed.v === 'number' && parsed.v > LINK_VERSION ? fail('version') : fail('corrupt');
  if (!isWellFormed(parsed)) return fail('corrupt');
  const payload = parsed as unknown as DuelPayload;
  if (typeof parsed.c !== 'string' || parsed.c !== checksum(payload)) return fail('corrupt');
  if (!payload.q.every(hasQuestion)) return fail('catalogue');
  return { ok: true, payload: seal(payload) };
}

export type HashRoute =
  | { kind: 'none' }
  | { kind: LinkKind; result: DecodeResult };

/** Wertet `location.hash` aus: `#d=…` Herausforderung, `#r=…` Rückmeldung. */
export function parseHash(hash: string, hasQuestion?: (id: string) => boolean): HashRoute {
  const m = hash.match(/^#?([dr])=(.*)$/s);
  if (!m) return { kind: 'none' };
  const kind = m[1] as LinkKind;
  const result = decodePayload(m[2]!.trim(), hasQuestion);
  // Herausforderungen tragen kein Ergebnis von B, Rückmeldungen immer.
  if (result.ok && (kind === 'r') !== (result.payload.b !== undefined)) return { kind, result: fail('corrupt') };
  return { kind, result };
}

/** Zufällige Duell-ID aus 8 Zeichen [a-z0-9]. */
export function randomDuelId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}
