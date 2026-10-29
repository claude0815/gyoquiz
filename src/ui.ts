import { catalogue, paragraphKey, questionById, sectionById, type Question, type Regulation } from './catalogue';
import {
  GRADE_BY_POINTS, answer, createRound, isAnswered, isCorrect, optionsOf, pickQuestions, recordStats, summarize,
  type Round, type RoundItem, type StatsMap,
} from './engine';
import { buildLink, challengeOf, encodePayload, isValidName, normalizeName, parseHash, randomDuelId, seal, MAX_QUESTIONS, MIN_QUESTIONS, type DuelPayload, type DuelPlayer, type LinkKind } from './duel/link';
import { createDuelRound, playerFromRound, resultsOf } from './duel/round';
import { compare, correctCount, formatTenths, runningScore, totalTenths } from './duel/score';
import { pickRematch, selectionLabel, selectionOf } from './duel/selection';
import { describeDuel, findDuel, loadDuels, saveDuels, upsertDuel, type StoredDuel } from './duel/store';
import { randomSeed, shuffle } from './rng';
import { KEYS, load, save } from './storage';

type View = 'setup' | 'quiz' | 'result' | 'duel';

/** Laufendes Duell: A spielt vor (noch ohne Link) oder B spielt gegen das Ergebnis von A. */
type ActiveDuel =
  | { role: 'challenger'; id: string; seed: number; name: string }
  | { role: 'opponent'; payload: DuelPayload; name: string };

/** Zwischenstand von A, solange der Herausforderungs-Link noch nicht existiert. */
interface DuelDraft {
  id: string;
  seed: number;
  name: string;
  round: Round;
}

/** Aus wessen Sicht ein Duell-Ergebnis gezeigt wird. */
type Perspective = 'a' | 'b' | 'neutral';

type ResultMode =
  | { kind: 'practice' }
  | { kind: 'sent'; payload: DuelPayload }
  | { kind: 'compare'; payload: DuelPayload; perspective: Perspective };

interface Settings {
  vo: 'all' | Regulation;
  sections: string[];
  /** Fragen pro Runde, 0 = alle passenden. */
  n: number;
  weak: boolean;
  cases: boolean;
}

const ALL_SECTION_IDS = catalogue.sections.map(s => s.id);
const DEFAULT_SETTINGS: Settings = { vo: 'all', sections: ALL_SECTION_IDS, n: 20, weak: false, cases: false };

function sanitizeSettings(s: Partial<Settings> | null | undefined): Settings {
  const v = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  return {
    vo: v.vo === 'GyO-VO' || v.vo === 'AP-V' ? v.vo : 'all',
    sections: Array.isArray(v.sections) ? v.sections.filter(id => sectionById.has(id)) : ALL_SECTION_IDS,
    n: [0, 10, 20, 40].includes(v.n) ? v.n : 20,
    weak: v.weak === true,
    cases: v.cases === true,
  };
}

let settings = sanitizeSettings(load<Partial<Settings>>(KEYS.settings, DEFAULT_SETTINGS));
let stats: StatsMap = load<StatsMap>(KEYS.stats, {});
let round: Round | null = null;
let view: View = 'setup';
/** Zeitpunkt, zu dem die aktuelle Frage angezeigt wurde (für die Antwortzeit). */
let shownAt = 0;
let duel: ActiveDuel | null = null;
let duels: StoredDuel[] = loadDuels();
/** Fragen für eine Revanche, die noch auf die Namenseingabe wartet. */
let pendingDuelQuestions: Question[] | null = null;

/* ---------- Hilfen ---------- */

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Element #${id} fehlt`);
  return node as T;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, c => ESC[c]!);

function voBadge(vo: Regulation): string {
  return `<span class="${vo === 'GyO-VO' ? 'vo g' : 'vo'}">${vo}</span>`;
}

function regulationOfSection(id: string): Regulation {
  return sectionById.get(id)!.regulation;
}

function getQuestion(id: string): Question {
  const q = questionById.get(id);
  if (!q) throw new Error(`Unbekannte Frage ${id}`);
  return q;
}

function show(next: View): void {
  view = next;
  el('view-setup').hidden = next !== 'setup';
  el('view-quiz').hidden = next !== 'quiz';
  el('view-result').hidden = next !== 'result';
  el('view-duel').hidden = next !== 'duel';
  window.scrollTo({ top: 0 });
}

/** Kleines DOM-Element mit Klasse und Text (Text immer über textContent). */
function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

/** Entfernt den Hash, ohne ein hashchange auszulösen. */
function clearHash(): void {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

function baseUrl(): string {
  return location.origin + location.pathname;
}

function duelLink(kind: LinkKind, payload: DuelPayload): string {
  return buildLink(baseUrl(), kind, kind === 'd' ? challengeOf(payload) : payload);
}

function savedName(): string {
  const n = load<unknown>(KEYS.name, '');
  return isValidName(n) ? n : '';
}

function storeDuel(d: StoredDuel): void {
  duels = upsertDuel(duels, d);
  saveDuels(duels);
}

function saveSettings(): void {
  save(KEYS.settings, settings);
}

/* ---------- Auswahl ---------- */

function activeSectionIds(): Set<string> {
  return new Set(
    catalogue.sections
      .filter(s => settings.sections.includes(s.id) && (settings.vo === 'all' || s.regulation === settings.vo))
      .map(s => s.id),
  );
}

function pool(): Question[] {
  const ids = activeSectionIds();
  return catalogue.questions.filter(q => ids.has(q.section) && (!settings.cases || q.isCase));
}

function roundSize(available: number): number {
  return settings.n === 0 ? available : Math.min(settings.n, available);
}

const isKnown = (q: Question): boolean => stats[q.id]?.lastCorrect === true;

/** Fragenzahl im Duell: 10, 20 oder 40; „Alle“ wird zu 40. */
function duelSize(available: number): number {
  return Math.min(settings.n === 0 ? MAX_QUESTIONS : settings.n, available, MAX_QUESTIONS);
}

/* ---------- Einstellungen ---------- */

function renderSetup(): void {
  document.querySelectorAll<HTMLButtonElement>('#seg-vo button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.vo === settings.vo)));
  document.querySelectorAll<HTMLButtonElement>('#seg-n button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.n) === settings.n)));
  el<HTMLInputElement>('opt-weak').checked = settings.weak;
  el<HTMLInputElement>('opt-case').checked = settings.cases;

  const groups = (['GyO-VO', 'AP-V'] as const).filter(vo => settings.vo === 'all' || settings.vo === vo);
  el('sec-list').innerHTML = groups.map(vo => {
    const info = catalogue.regulations.find(r => r.short === vo);
    const rows = catalogue.sections.filter(s => s.regulation === vo).map(s => {
      const qs = catalogue.questions.filter(q => q.section === s.id && (!settings.cases || q.isCase));
      const known = qs.filter(isKnown).length;
      const pct = qs.length ? Math.round((known / qs.length) * 100) : 0;
      return `<label class="secrow" for="sec-${esc(s.id)}">
        <input type="checkbox" id="sec-${esc(s.id)}" data-sec="${esc(s.id)}" ${settings.sections.includes(s.id) ? 'checked' : ''}>
        <span class="nm"><b>${esc(s.name)}</b><span class="rg">${esc(s.range)}</span></span>
        <span class="ct">${known}/${qs.length} sicher</span>
        <span class="bar"><span class="meter" aria-hidden="true"><i style="width:${pct}%"></i></span></span>
      </label>`;
    }).join('');
    return `<div class="secgroup">
      <div class="secgroup-head"><span>${voBadge(vo)} <span class="poolinfo">${esc(info?.title ?? '')}</span></span>
        <span class="linkbtns"><button type="button" class="linkbtn" data-all="${vo}">alle</button><button type="button" class="linkbtn" data-none="${vo}">keine</button></span></div>
      ${rows}</div>`;
  }).join('');

  const p = pool();
  const n = roundSize(p.length);
  el('pool-info').textContent = p.length ? `${n} von ${p.length} passenden Fragen` : 'Wähle mindestens einen Abschnitt mit passenden Fragen.';
  const start = el<HTMLButtonElement>('btn-start');
  start.disabled = !p.length;
  start.textContent = p.length ? `Runde starten · ${n} Fragen` : 'Runde starten';

  const duelBtn = el<HTMLButtonElement>('btn-duel');
  const canDuel = p.length >= MIN_QUESTIONS;
  duelBtn.disabled = !canDuel;
  duelBtn.textContent = canDuel ? `Duell starten · ${duelSize(p.length)} Fragen` : 'Duell starten';
  if (p.length && !canDuel) el('pool-info').textContent += ` · Für ein Duell braucht es mindestens ${MIN_QUESTIONS}.`;
  if (!canDuel) closeDuelForm();
  renderMyDuels();

  const seen = catalogue.questions.filter(q => stats[q.id]).length;
  const known = catalogue.questions.filter(isKnown).length;
  el('learn-line').innerHTML =
    `<span><strong class="mono">${catalogue.questions.length}</strong> Fragen im Pool</span>` +
    `<span><strong class="mono">${seen}</strong> schon beantwortet</span>` +
    `<span><strong class="mono">${known}</strong> zuletzt richtig</span>`;
  el('btn-reset').hidden = seen === 0;
}

function renderStatic(): void {
  el('stand').textContent = catalogue.regulations.map(r => `${r.short} v. ${r.dated}`).join(' · ') + ` · Fragenkatalog v${catalogue.version}`;

  el('glossary').innerHTML = catalogue.glossary.map(g => `<dt>${esc(g.term)}</dt><dd>${esc(g.explanation)}</dd>`).join('');

  el('cover-list').innerHTML = catalogue.sections.map(s => {
    const qs = catalogue.questions.filter(q => q.section === s.id);
    const chips = s.paragraphs.map(p => {
      const c = qs.filter(q => paragraphKey(q.ref) === p).length;
      return `<span class="chip" title="${c} Fragen">${esc(p)} · ${c}</span>`;
    }).join('');
    return `<div class="row"><span>${voBadge(s.regulation)} <b>${esc(s.name)}</b> <span class="poolinfo">· ${qs.length} Fragen</span></span><span class="chips">${chips}</span></div>`;
  }).join('');

  el('foot').innerHTML =
    `<p>Grundlage: ${catalogue.regulations.map(r => `<a href="${esc(r.source)}" target="_blank" rel="noopener">${esc(r.title)} (${r.short}) vom ${esc(r.dated)}</a>, ${esc(r.version)}`).join('; ')}.</p>` +
    `<p>Das Quiz ersetzt nicht den Verordnungstext; bei Abweichungen gilt die amtliche Fassung. Dein Lernstand wird nur in diesem Browser gespeichert. Fragenkatalog Version ${catalogue.version}, Stand ${esc(catalogue.updated)}.</p>`;
}

/* ---------- Runde ---------- */

function startRound(questions: Question[]): void {
  if (!questions.length) return;
  duel = null;
  round = createRound(questions);
  enterQuiz();
}

function enterQuiz(): void {
  const quit = el('btn-quit');
  quit.textContent = duel ? 'Duell aufgeben' : 'Runde beenden';
  el('quit-confirm').hidden = true;
  const bar = el('q-duelbar');
  bar.hidden = !duel;
  if (duel) bar.textContent = duel.role === 'opponent' ? `Duell gegen ${duel.payload.a.n}` : 'Duell · du legst vor, danach verschickst du den Link';
  show('quiz');
  renderQuestion();
}

function current(): RoundItem {
  if (!round) throw new Error('Keine laufende Runde');
  return round.items[round.index]!;
}

function renderCount(): void {
  if (!round) return;
  const s = summarize(round);
  el('q-count').innerHTML = `Frage <b>${round.index + 1}</b> von ${round.items.length} · <b>${s.correct}</b>/${s.answered} richtig`;
}

function renderTrack(): void {
  if (!round) return;
  const items = round.items;
  if (items.length <= 60) {
    el('q-track').innerHTML = `<div class="track" aria-hidden="true">${items.map((it, i) => {
      const cls = isAnswered(it) ? (isCorrect(it) ? 'ok' : 'bad') : i === round!.index ? 'now' : '';
      return `<span class="${cls}"></span>`;
    }).join('')}</div>`;
  } else {
    const ok = items.filter(isCorrect).length;
    const bad = items.filter(it => isAnswered(it) && !isCorrect(it)).length;
    el('q-track').innerHTML = `<div class="contbar" aria-hidden="true"><i class="ok" style="width:${(ok / items.length) * 100}%"></i><i class="bad" style="width:${(bad / items.length) * 100}%"></i></div>`;
  }
}

function renderQuestion(): void {
  const it = current();
  const q = getQuestion(it.questionId);
  const s = sectionById.get(q.section)!;
  renderCount();
  renderTrack();
  el('q-meta').innerHTML = `${voBadge(s.regulation)}<span>${esc(s.name)}</span>${q.isCase ? '<span class="tag">Fall</span>' : ''}`;
  el('q-text').textContent = q.text;
  const opts = optionsOf(q);
  el('q-opts').innerHTML = it.order
    .map((o, i) => `<button type="button" class="opt" data-i="${i}"><span class="k">${i + 1}</span><span class="tx">${esc(opts[o])}</span></button>`)
    .join('');
  el('q-feedback').hidden = true;
  el('q-duel').hidden = true;
  el('btn-next').hidden = true;
  if (isAnswered(it)) reveal(false);
  else shownAt = performance.now();
}

function onAnswer(position: number): void {
  const it = current();
  if (!answer(it, position, performance.now() - shownAt)) return;
  stats = recordStats(stats, it.questionId, isCorrect(it));
  save(KEYS.stats, stats);
  persistDuel();
  reveal(true);
}

function reveal(focusNext: boolean): void {
  if (!round) return;
  const it = current();
  const q = getQuestion(it.questionId);
  const ok = isCorrect(it);
  document.querySelectorAll<HTMLButtonElement>('#q-opts .opt').forEach(b => {
    const i = Number(b.dataset.i);
    b.disabled = true;
    if (it.order[i] === 0) b.classList.add('right');
    else if (i === it.chosen) b.classList.add('wrong');
    else b.classList.add('dim');
  });
  const fb = el('q-feedback');
  fb.className = `feedback ${ok ? 'ok' : 'bad'}`;
  fb.innerHTML =
    `<span class="verdict">${ok ? 'Richtig.' : `Nicht ganz. Richtig ist: ${esc(q.correct)}`}</span>` +
    `<span class="ref">${esc(q.ref)} ${regulationOfSection(q.section)}</span>` +
    `<span>${esc(q.explanation)}</span>`;
  fb.hidden = false;
  const next = el<HTMLButtonElement>('btn-next');
  next.textContent = round.index === round.items.length - 1 ? 'Auswertung' : 'Weiter';
  next.hidden = false;
  renderTrack();
  renderCount();
  renderDuelHint();
  if (focusNext) next.focus({ preventScroll: true });
}

/** Nach jeder Antwort von B: wie hat A diese Frage beantwortet, und wie steht es? */
function renderDuelHint(): void {
  const box = el('q-duel');
  if (!round || duel?.role !== 'opponent' || !isAnswered(current())) {
    box.hidden = true;
    return;
  }
  const a = duel.payload.a;
  const i = round.index;
  const aOk = a.r[i] === '1';
  const who = node('p', `who ${aOk ? 'ok' : 'bad'}`);
  who.append(node('span', 'sym', aOk ? '✓' : '✗'), node('span', '', `${a.n} ${aOk ? 'hatte das richtig' : 'lag hier falsch'} (${formatTenths(a.t[i] ?? 0)})`));
  const sc = runningScore(resultsOf(round), a, i);
  const tally = node('p', 'tally');
  tally.append('Spielstand: Du ', node('b', 'mono', String(sc.me)), ' : ', node('b', 'mono', String(sc.other)), ` ${a.n}`);
  box.replaceChildren(who, tally);
  box.hidden = false;
}

function goNext(): void {
  if (!round) return;
  if (round.index < round.items.length - 1) {
    round.index++;
    persistDuel();
    renderQuestion();
    window.scrollTo({ top: 0 });
  } else if (duel) {
    finishDuel();
  } else {
    renderResult();
  }
}

/* ---------- Ergebnis ---------- */

function renderResult(mode: ResultMode = { kind: 'practice' }): void {
  const compareMode = mode.kind === 'compare';
  el('r-score').hidden = !round || compareMode;
  el('r-breakdown-wrap').hidden = !round || compareMode;
  el('r-wrong-wrap').hidden = true;
  el('btn-retry-wrong').hidden = true;
  if (round) renderOwnResult(round);

  el('btn-again').hidden = compareMode;
  el('btn-setup').hidden = compareMode;
  el('btn-rematch').hidden = !compareMode;
  el('btn-free').hidden = !compareMode;
  if (compareMode) el('btn-retry-wrong').hidden = true;

  const banner = el('r-banner');
  const share = el('r-share');
  banner.hidden = true;
  share.hidden = true;
  el('r-compare-wrap').hidden = !compareMode;
  if (mode.kind === 'sent') {
    renderChallengeShare(share, mode.payload);
    share.hidden = false;
  } else if (mode.kind === 'compare') {
    renderBanner(mode.payload, mode.perspective);
    renderCompareTable(mode.payload, mode.perspective);
    resultPayload = mode.payload;
    resultPerspective = mode.perspective;
    if (mode.perspective === 'b') {
      renderReturnShare(share, mode.payload);
      share.hidden = false;
    }
  }
  show('result');
}

let resultPayload: DuelPayload | null = null;
let resultPerspective: Perspective = 'neutral';

function renderOwnResult(round: Round): void {
  const s = summarize(round);
  el('r-points').innerHTML = `${s.points}<small>Punkte</small>`;
  el('r-note').textContent = s.answered ? `Note ${GRADE_BY_POINTS[s.points]}` : 'Keine Frage beantwortet';
  el('r-line').innerHTML = `<span class="mono">${s.correct}</span> von <span class="mono">${s.answered}</span> richtig · <span class="mono">${s.pct}&#8239;%</span>`;

  const bySection = new Map<string, { n: number; ok: number }>();
  for (const it of round.items.filter(isAnswered)) {
    const sec = getQuestion(it.questionId).section;
    const b = bySection.get(sec) ?? { n: 0, ok: 0 };
    b.n++;
    if (isCorrect(it)) b.ok++;
    bySection.set(sec, b);
  }
  el('r-breakdown').innerHTML = catalogue.sections.filter(sec => bySection.has(sec.id)).map(sec => {
    const b = bySection.get(sec.id)!;
    const p = Math.round((b.ok / b.n) * 100);
    return `<div class="brow"><span class="n">${voBadge(sec.regulation)}${esc(sec.name)}</span>
      <span class="meter" aria-hidden="true"><i style="width:${p}%"></i></span><span class="v">${b.ok}/${b.n}</span></div>`;
  }).join('') || '<p class="poolinfo">Noch keine Antworten in dieser Runde.</p>';

  const wrong = round.items.filter(it => isAnswered(it) && !isCorrect(it));
  const retry = el<HTMLButtonElement>('btn-retry-wrong');
  retry.hidden = wrong.length === 0;
  retry.textContent = `Falsche wiederholen (${wrong.length})`;
  el('r-wrong-wrap').hidden = wrong.length === 0;
  el('r-wrong').innerHTML = wrong.map(it => {
    const q = getQuestion(it.questionId);
    const opts = optionsOf(q);
    return `<div class="witem"><span class="wq">${esc(q.text)}</span>
      <span>Deine Antwort: <span class="yours">${esc(opts[it.order[it.chosen!]!])}</span></span>
      <span class="corr">${esc(q.correct)}</span>
      <span class="why">${esc(q.explanation)}</span>
      <span class="ref">${esc(q.ref)} ${regulationOfSection(q.section)}</span></div>`;
  }).join('');
}

/* ---------- Duell ---------- */

function startDuelAsChallenger(questions: Question[], name: string): void {
  if (questions.length < MIN_QUESTIONS) return;
  const seed = randomSeed();
  duel = { role: 'challenger', id: randomDuelId(), seed, name };
  round = createDuelRound(questions.slice(0, MAX_QUESTIONS), seed);
  clearHash();
  persistDuel();
  enterQuiz();
}

function startDuelAsOpponent(payload: DuelPayload, name: string, resume?: Round): void {
  duel = { role: 'opponent', payload, name };
  round = resume ?? createDuelRound(payload.q.map(getQuestion), payload.s);
  persistDuel();
  enterQuiz();
}

/** Speichert den Zwischenstand, damit ein Neuladen an derselben Frage fortsetzt. */
function persistDuel(): void {
  if (!duel || !round) return;
  if (duel.role === 'challenger') {
    const draft: DuelDraft = { id: duel.id, seed: duel.seed, name: duel.name, round };
    save(KEYS.duelDraft, draft);
  } else {
    storeDuel({ id: duel.payload.id, role: 'opponent', payload: duel.payload, inProgress: round });
  }
}

/** Passt eine gespeicherte Runde noch zu den Fragen des Duells? */
function roundMatches(r: unknown, questionIds: readonly string[]): r is Round {
  if (typeof r !== 'object' || r === null) return false;
  const { items, index } = r as Partial<Round>;
  return Array.isArray(items) && items.length === questionIds.length && Number.isInteger(index) && index! >= 0 && index! < items.length &&
    items.every((it, i) => it?.questionId === questionIds[i] && Array.isArray(it.order) && it.order.length === 4);
}

function resumeDraft(): boolean {
  const d = load<Partial<DuelDraft> | null>(KEYS.duelDraft, null);
  if (!d || typeof d.id !== 'string' || typeof d.seed !== 'number' || !isValidName(d.name)) return false;
  const ids = Array.isArray(d.round?.items) ? d.round.items.map(it => it?.questionId) : [];
  if (!ids.every(id => typeof id === 'string' && questionById.has(id)) || !roundMatches(d.round, ids as string[])) return false;
  duel = { role: 'challenger', id: d.id, seed: d.seed, name: d.name };
  round = d.round;
  enterQuiz();
  return true;
}

function finishDuel(): void {
  if (!duel || !round) return;
  const me = playerFromRound(duel.name, round);
  const finishedAt = new Date().toISOString();
  if (duel.role === 'challenger') {
    const payload = seal({ v: 1, k: catalogue.version, id: duel.id, s: duel.seed, q: round.items.map(it => it.questionId), a: me });
    storeDuel({ id: payload.id, role: 'challenger', payload, finishedAt });
    save(KEYS.duelDraft, null);
    duel = null;
    renderResult({ kind: 'sent', payload });
  } else {
    const payload = seal({ ...duel.payload, b: me });
    storeDuel({ id: payload.id, role: 'opponent', payload, finishedAt });
    duel = null;
    renderResult({ kind: 'compare', payload, perspective: 'b' });
  }
}

/** Beide Seiten eines Ergebnisses aus der gewählten Sicht: links „ich“, rechts der Gegner. */
function sides(p: DuelPayload, perspective: Perspective): { me: DuelPlayer; other: DuelPlayer; meLabel: string } {
  const b = p.b!;
  if (perspective === 'b') return { me: b, other: p.a, meLabel: 'Du' };
  return { me: p.a, other: b, meLabel: perspective === 'a' ? 'Du' : p.a.n };
}

function renderBanner(p: DuelPayload, perspective: Perspective): void {
  const { me, other } = sides(p, perspective);
  const c = compare(me, other);
  const score = `${c.myCorrect} : ${c.otherCorrect}`;
  const gap = formatTenths(Math.abs(c.timeDiffTenths));
  const tie = c.myCorrect === c.otherCorrect;
  let head: string;
  let sub: string;
  if (perspective === 'neutral') {
    head = `${me.n} gegen ${other.n}: ${score}`;
    const winner = c.outcome === 'win' ? me.n : other.n;
    sub = c.outcome === 'draw' ? 'Unentschieden, auf die Zehntelsekunde gleich schnell.' : `${winner} gewinnt${tie ? `, ${gap} schneller` : ''}.`;
  } else {
    const fasterText = c.outcome === 'win' ? `du warst ${gap} schneller` : `${other.n} war ${gap} schneller`;
    if (c.outcome === 'draw') head = `Unentschieden. ${score} gegen ${other.n}`;
    else if (perspective === 'a') head = `Du hast gegen ${other.n} ${c.outcome === 'win' ? 'gewonnen' : 'verloren'}`;
    else head = `${c.outcome === 'win' ? 'Gewonnen!' : 'Verloren.'} ${score}${tie ? `, ${fasterText}` : ` gegen ${other.n}`}`;
    const times = `Gesamtzeit: du ${formatTenths(totalTenths(me))}, ${other.n} ${formatTenths(totalTenths(other))}.`;
    if (c.outcome === 'draw') sub = `Gleiche Gesamtzeit: ${formatTenths(totalTenths(me))}.`;
    else if (perspective === 'a') sub = `${score}${tie ? `, ${fasterText}` : ''}. ${times}`;
    else sub = times;
  }
  const banner = el('r-banner');
  const kind = perspective === 'neutral' ? 'neutral' : c.outcome;
  banner.className = `banner ${kind}`;
  el('r-banner-sym').textContent = kind === 'win' ? '✓' : kind === 'loss' ? '✗' : '=';
  el('r-banner-head').textContent = head;
  el('r-banner-sub').textContent = sub;
  banner.hidden = false;
}

function markCell(ok: boolean, tenths: number | undefined): HTMLTableCellElement {
  const td = node('td', 'mk');
  td.append(node('span', ok ? 'ok' : 'bad', ok ? '✓' : '✗'), node('span', 'sr', ok ? 'richtig' : 'falsch'));
  if (tenths !== undefined) td.append(node('small', 'mono', formatTenths(tenths)));
  return td;
}

function renderCompareTable(p: DuelPayload, perspective: Perspective): void {
  const { me, other, meLabel } = sides(p, perspective);
  const table = el<HTMLTableElement>('r-compare');
  const head = node('tr');
  head.append(node('th', 'num', 'Nr.'), node('th', '', 'Frage'), node('th', 'mk', meLabel), node('th', 'mk', other.n));
  const thead = node('thead');
  thead.append(head);
  const tbody = node('tbody');
  p.q.forEach((id, i) => {
    const tr = node('tr');
    const qtd = node('td', 'qt');
    const text = node('span', '', questionById.get(id)?.text ?? id);
    qtd.append(text);
    tr.append(node('td', 'num mono', String(i + 1)), qtd, markCell(me.r[i] === '1', me.t[i]), markCell(other.r[i] === '1', other.t[i]));
    tbody.append(tr);
  });
  const foot = node('tr');
  const total = (pl: DuelPlayer) => {
    const td = node('td', 'mk');
    td.append(node('b', 'mono', `${correctCount(pl)}/${p.q.length}`), node('small', 'mono', formatTenths(totalTenths(pl))));
    return td;
  };
  const label = node('td', '', 'Richtig · Gesamtzeit');
  label.colSpan = 2;
  foot.append(label, total(me), total(other));
  const tfoot = node('tfoot');
  tfoot.append(foot);
  table.replaceChildren(thead, tbody, tfoot);
}

/** Bereich zum Verschicken eines Links: Teilen-Menü (falls vorhanden), Kopieren, Textfeld. */
function renderShare(box: HTMLElement, o: { title: string; text: string; shareText: string; link: string }): void {
  const h = node('h3', '', o.title);
  const intro = node('p', 'muted', o.text);
  const status = node('span', 'status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const field = node('input', 'linkfield');
  field.type = 'text';
  field.readOnly = true;
  field.value = o.link;
  field.setAttribute('aria-label', 'Link');
  field.addEventListener('focus', () => field.select());
  const manual = () => {
    field.focus();
    field.select();
    status.textContent = 'Bitte manuell kopieren';
  };
  const row = node('div', 'actions');
  if (typeof navigator.share === 'function') {
    const shareBtn = node('button', 'btn primary', 'Teilen …');
    shareBtn.type = 'button';
    shareBtn.addEventListener('click', () => {
      navigator.share({ title: document.title, text: o.shareText, url: o.link }).catch(() => { /* abgebrochen */ });
    });
    row.append(shareBtn);
  }
  const copyBtn = node('button', typeof navigator.share === 'function' ? 'btn' : 'btn primary', 'Link kopieren');
  copyBtn.type = 'button';
  copyBtn.addEventListener('click', () => {
    status.textContent = '';
    if (!navigator.clipboard?.writeText) return manual();
    navigator.clipboard.writeText(o.link).then(() => { status.textContent = 'Link kopiert'; }, manual);
  });
  row.append(copyBtn);
  box.replaceChildren(h, intro, row, field, status);
}

function renderChallengeShare(box: HTMLElement, p: DuelPayload): void {
  renderShare(box, {
    title: 'Herausforderung verschicken',
    text: 'Schick diesen Link an die Person, die du herausfordern willst. Dein Ergebnis wird erst nach und nach aufgedeckt.',
    shareText: `${p.a.n} fordert dich zum GyO-VO & AP-V Quiz heraus: ${p.q.length} Fragen. Schaffst du mehr?`,
    link: duelLink('d', p),
  });
}

function renderReturnShare(box: HTMLElement, p: DuelPayload): void {
  renderShare(box, {
    title: `Ergebnis an ${p.a.n} zurückschicken`,
    text: `Mit diesem Link sieht ${p.a.n}, wie das Duell ausgegangen ist.`,
    shareText: `${p.b!.n} hat deine Herausforderung im GyO-VO & AP-V Quiz gespielt. Hier ist das Ergebnis:`,
    link: duelLink('r', p),
  });
}

function showDuelCard(part: 'invite' | 'own' | 'error', title: string): void {
  el('duel-title').textContent = title;
  el('duel-invite').hidden = part !== 'invite';
  el('duel-own').hidden = part !== 'own';
  el('duel-error').hidden = part !== 'error';
  duel = null;
  round = null;
  show('duel');
}

let invitePayload: DuelPayload | null = null;

function showInvite(p: DuelPayload): void {
  invitePayload = p;
  const facts = el('inv-facts');
  const sel = selectionOf(p.q);
  facts.replaceChildren(
    node('li', '', `${p.q.length} Fragen · ${selectionLabel(sel)}`),
    node('li', '', 'Mehr richtige Antworten gewinnt, bei Gleichstand die kürzere Zeit.'),
    node('li', '', `Nach jeder Antwort siehst du, ob ${p.a.n} die Frage richtig hatte.`),
  );
  el<HTMLInputElement>('inv-name').value = savedName();
  el('inv-name-error').textContent = '';
  showDuelCard('invite', `${p.a.n} fordert dich heraus`);
}

let ownPayload: DuelPayload | null = null;

function showOwnChallenge(d: StoredDuel): void {
  ownPayload = d.payload;
  const a = d.payload.a;
  el('own-text').textContent = `Du hast ${correctCount(a)} von ${d.payload.q.length} Fragen richtig beantwortet (${formatTenths(totalTenths(a))}).` +
    (d.payload.b ? ` ${d.payload.b.n} hat schon geantwortet.` : ' Noch keine Rückmeldung.');
  renderChallengeShare(el('own-share'), d.payload);
  const res = el<HTMLButtonElement>('btn-own-result');
  res.hidden = !d.payload.b;
  if (d.payload.b) res.textContent = `Ergebnis gegen ${d.payload.b.n} ansehen`;
  showDuelCard('own', 'Das ist deine eigene Herausforderung');
}

function showDuelError(message: string): void {
  el('err-text').textContent = message;
  showDuelCard('error', 'Dieser Link funktioniert nicht');
}

function showCompare(payload: DuelPayload, perspective: Perspective): void {
  duel = null;
  round = null;
  renderResult({ kind: 'compare', payload, perspective });
}

/** Wertet den Hash aus: `#d=…` Herausforderung, `#r=…` Rückmeldung, sonst Lernmodus. */
function route(initial: boolean): void {
  duels = loadDuels();
  const r = parseHash(location.hash);
  if (r.kind === 'none') {
    if (initial && resumeDraft()) return;
    if (!initial && view === 'quiz' && duel?.role === 'challenger') return;
    duel = null;
    renderSetup();
    show('setup');
    return;
  }
  if (!r.result.ok) return showDuelError(r.result.message);
  const p = r.result.payload;
  const stored = findDuel(duels, p.id);
  if (r.kind === 'd') {
    if (stored?.role === 'challenger') return showOwnChallenge(stored);
    if (stored?.role === 'opponent' && stored.payload.b) return showCompare(stored.payload, 'b');
    const name = savedName();
    if (stored?.role === 'opponent' && name && roundMatches(stored.inProgress, p.q)) return startDuelAsOpponent(p, name, stored.inProgress);
    return showInvite(p);
  }
  if (stored?.role === 'challenger') {
    storeDuel({ ...stored, payload: p });
    return showCompare(p, 'a');
  }
  showCompare(p, stored?.role === 'opponent' ? 'b' : 'neutral');
}

function goFree(): void {
  if (location.hash) location.hash = '';
  else {
    duel = null;
    renderSetup();
    show('setup');
  }
}

function renderMyDuels(): void {
  const list = duels.slice(0, 10);
  el('my-duels-wrap').hidden = list.length === 0;
  el('my-duels').replaceChildren(...list.map(d => {
    const e = describeDuel(d);
    const li = node('li');
    const a = node('a', '', e.opponent ? `gegen ${e.opponent}` : `Herausforderung · ${d.payload.q.length} Fragen`);
    a.href = `#${e.kind}=${encodePayload(e.kind === 'd' ? challengeOf(d.payload) : d.payload)}`;
    const date = d.finishedAt ? new Date(d.finishedAt).toLocaleDateString('de-DE') : '';
    li.append(a, node('span', 'st', e.status), node('span', 'dt mono', date));
    return li;
  }));
}

function openDuelForm(questions: Question[] | null): void {
  pendingDuelQuestions = questions;
  const form = el('duel-form');
  form.hidden = false;
  el('btn-duel').setAttribute('aria-expanded', 'true');
  const input = el<HTMLInputElement>('duel-name');
  if (!input.value) input.value = savedName();
  el('duel-name-hint').textContent = 'Wird im Link mitgeschickt. Vorname oder Kürzel reicht.' +
    (settings.weak && !questions ? ' „Unsicheres bevorzugen“ gilt im Duell nicht.' : '');
  el('duel-name-error').textContent = '';
  input.focus();
}

function closeDuelForm(): void {
  el('duel-form').hidden = true;
  el('btn-duel').setAttribute('aria-expanded', 'false');
  pendingDuelQuestions = null;
}

/** Liest und prüft ein Namensfeld; zeigt sonst die Fehlermeldung. */
function readName(inputId: string, errorId: string): string | null {
  const input = el<HTMLInputElement>(inputId);
  const name = normalizeName(input.value);
  if (!isValidName(name)) {
    el(errorId).textContent = 'Bitte gib einen Namen mit 1 bis 24 Zeichen ein.';
    input.focus();
    return null;
  }
  el(errorId).textContent = '';
  save(KEYS.name, name);
  return name;
}

function rematch(): void {
  const p = resultPayload;
  if (!p) return;
  const name = resultPerspective === 'b' ? p.b!.n : resultPerspective === 'a' ? p.a.n : savedName();
  const questions = pickRematch(selectionOf(p.q), p.q, p.q.length);
  clearHash();
  if (name) return startDuelAsChallenger(questions, name);
  renderSetup();
  show('setup');
  openDuelForm(questions);
}

/* ---------- Ereignisse ---------- */

function newRoundFromSettings(): void {
  const p = pool();
  if (!p.length) {
    renderSetup();
    show('setup');
    return;
  }
  startRound(pickQuestions(p, roundSize(p.length), { preferWeak: settings.weak, stats }));
}

function bindEvents(): void {
  el('seg-vo').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b?.dataset.vo) return;
    settings.vo = b.dataset.vo as Settings['vo'];
    saveSettings();
    renderSetup();
  });
  el('seg-n').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b?.dataset.n) return;
    settings.n = Number(b.dataset.n);
    saveSettings();
    renderSetup();
  });
  el('sec-list').addEventListener('change', e => {
    const input = e.target as HTMLInputElement;
    const id = input.dataset.sec;
    if (!id) return;
    settings.sections = input.checked ? [...new Set([...settings.sections, id])] : settings.sections.filter(s => s !== id);
    saveSettings();
    renderSetup();
  });
  el('sec-list').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    const vo = b.dataset.all ?? b.dataset.none;
    if (!vo) return;
    const ids = catalogue.sections.filter(s => s.regulation === vo).map(s => s.id);
    settings.sections = b.dataset.all ? [...new Set([...settings.sections, ...ids])] : settings.sections.filter(s => !ids.includes(s));
    saveSettings();
    renderSetup();
  });
  el<HTMLInputElement>('opt-weak').addEventListener('change', e => {
    settings.weak = (e.target as HTMLInputElement).checked;
    saveSettings();
  });
  el<HTMLInputElement>('opt-case').addEventListener('change', e => {
    settings.cases = (e.target as HTMLInputElement).checked;
    saveSettings();
    renderSetup();
  });
  el('btn-start').addEventListener('click', newRoundFromSettings);
  el('btn-duel').addEventListener('click', () => {
    if (el('duel-form').hidden) openDuelForm(null);
    else closeDuelForm();
  });
  el('duel-cancel').addEventListener('click', closeDuelForm);
  el('duel-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = readName('duel-name', 'duel-name-error');
    if (!name) return;
    const p = pool();
    const questions = pendingDuelQuestions ?? pickQuestions(p, duelSize(p.length));
    closeDuelForm();
    startDuelAsChallenger(questions, name);
  });
  el('inv-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = readName('inv-name', 'inv-name-error');
    if (!name || !invitePayload) return;
    const stored = findDuel(duels, invitePayload.id);
    const resume = stored?.role === 'opponent' && roundMatches(stored.inProgress, invitePayload.q) ? stored.inProgress : undefined;
    startDuelAsOpponent(invitePayload, name, resume);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-free]').forEach(b => b.addEventListener('click', goFree));
  el('btn-own-result').addEventListener('click', () => {
    if (ownPayload?.b) location.hash = `r=${encodePayload(ownPayload)}`;
  });
  el('btn-rematch').addEventListener('click', rematch);
  el('q-opts').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.opt');
    if (b) onAnswer(Number(b.dataset.i));
  });
  el('btn-next').addEventListener('click', goNext);
  el('btn-quit').addEventListener('click', () => {
    if (!duel) return renderResult();
    el('quit-confirm').hidden = false;
    el('btn-quit-no').focus();
  });
  el('btn-quit-no').addEventListener('click', () => {
    el('quit-confirm').hidden = true;
    el('btn-quit').focus();
  });
  el('btn-quit-yes').addEventListener('click', finishDuel);
  el('btn-again').addEventListener('click', newRoundFromSettings);
  el('btn-setup').addEventListener('click', () => {
    renderSetup();
    show('setup');
  });
  el('btn-retry-wrong').addEventListener('click', () => {
    if (!round) return;
    const wrong = round.items.filter(it => isAnswered(it) && !isCorrect(it)).map(it => getQuestion(it.questionId));
    startRound(shuffle(wrong));
  });
  el('btn-reset').addEventListener('click', () => { el('reset-confirm').hidden = false; });
  el('btn-reset-no').addEventListener('click', () => { el('reset-confirm').hidden = true; });
  el('btn-reset-yes').addEventListener('click', () => {
    stats = {};
    save(KEYS.stats, stats);
    el('reset-confirm').hidden = true;
    renderSetup();
  });

  document.addEventListener('keydown', e => {
    if (view !== 'quiz' || !round || e.altKey || e.ctrlKey || e.metaKey) return;
    const it = current();
    const keyMap: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3, a: 0, b: 1, c: 2, d: 3 };
    const pos = keyMap[e.key.toLowerCase()];
    if (!isAnswered(it) && pos !== undefined) {
      e.preventDefault();
      onAnswer(pos);
    } else if (isAnswered(it) && (e.key === 'Enter' || e.key === 'ArrowRight')) {
      // Enter auf einem Button löst dessen eigenen Klick aus (z. B. „Weiter“ oder „Ja, aufgeben“).
      if (e.key === 'Enter' && document.activeElement instanceof HTMLButtonElement) return;
      e.preventDefault();
      goNext();
    }
  });
}

export function startApp(): void {
  renderStatic();
  bindEvents();
  window.addEventListener('hashchange', () => route(false));
  route(true);
}
