import { catalogue, paragraphKey, questionById, sectionById, type Question, type Regulation } from './catalogue';
import {
  GRADE_BY_POINTS, answer, createRound, isAnswered, isCorrect, optionsOf, pickQuestions, recordStats, summarize,
  type Round, type RoundItem, type StatsMap,
} from './engine';
import { shuffle } from './rng';
import { KEYS, load, save } from './storage';

type View = 'setup' | 'quiz' | 'result';

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
  window.scrollTo({ top: 0 });
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
  round = createRound(questions);
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
  el('btn-next').hidden = true;
  if (isAnswered(it)) reveal(false);
  else shownAt = performance.now();
}

function onAnswer(position: number): void {
  const it = current();
  if (!answer(it, position, performance.now() - shownAt)) return;
  stats = recordStats(stats, it.questionId, isCorrect(it));
  save(KEYS.stats, stats);
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
  if (focusNext) next.focus({ preventScroll: true });
}

function goNext(): void {
  if (!round) return;
  if (round.index < round.items.length - 1) {
    round.index++;
    renderQuestion();
    window.scrollTo({ top: 0 });
  } else {
    renderResult();
  }
}

/* ---------- Ergebnis ---------- */

function renderResult(): void {
  if (!round) return;
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
  show('result');
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
  el('q-opts').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.opt');
    if (b) onAnswer(Number(b.dataset.i));
  });
  el('btn-next').addEventListener('click', goNext);
  el('btn-quit').addEventListener('click', renderResult);
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
      if (e.key === 'Enter' && document.activeElement === el('btn-next')) return;
      e.preventDefault();
      goNext();
    }
  });
}

export function startApp(): void {
  renderStatic();
  bindEvents();
  renderSetup();
  show('setup');
}
