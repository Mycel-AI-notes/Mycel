import type { EditorView, Panel, ViewUpdate } from '@codemirror/view';
import {
  SearchQuery,
  getSearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  closeSearchPanel,
} from '@codemirror/search';

/**
 * Mycel search panel — a compact floating search/replace card that replaces
 * CodeMirror's stock panel. Built as plain DOM (CodeMirror panels are not
 * React) and styled via `.mycel-search*` classes in `index.css`.
 */

const SVG = (inner: string) =>
  `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const icons = {
  search: SVG('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>'),
  up: SVG('<path d="M4 10l4-4 4 4"/>'),
  down: SVG('<path d="M4 6l4 4 4-4"/>'),
  close: SVG('<path d="M4 4l8 8M12 4l-8 8"/>'),
  expand: SVG('<path d="M6 4l4 4-4 4"/>'),
  replace: SVG('<path d="M3 5h6M7.5 3l2 2-2 2M13 11H7M8.5 9l-2 2 2 2"/>'),
};

function mkButton(opts: {
  className?: string;
  title?: string;
  html?: string;
  text?: string;
}): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `mycel-search-btn${opts.className ? ' ' + opts.className : ''}`;
  if (opts.title) btn.title = opts.title;
  if (opts.html) btn.innerHTML = opts.html;
  if (opts.text) btn.textContent = opts.text;
  return btn;
}

export function mycelSearchPanel(view: EditorView): Panel {
  const dom = document.createElement('div');
  dom.className = 'mycel-search';
  dom.setAttribute('role', 'search');
  // Keep keystrokes inside the panel from leaking into the editor.
  dom.addEventListener('keydown', (e) => e.stopPropagation());

  let caseSensitive = false;
  let regexp = false;
  let wholeWord = false;

  // ── Search row ───────────────────────────────────────────────────────
  const searchField = document.createElement('div');
  searchField.className = 'mycel-search-field';
  searchField.innerHTML = `<span class="mycel-search-icon">${icons.search}</span>`;

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'mycel-search-input';
  searchInput.placeholder = 'Find in note';
  searchInput.setAttribute('aria-label', 'Find in note');

  const countEl = document.createElement('span');
  countEl.className = 'mycel-search-count';

  searchField.append(searchInput, countEl);

  const caseBtn = mkButton({
    className: 'mycel-search-btn--toggle mycel-search-btn--text',
    title: 'Match case',
    text: 'Aa',
  });
  const wordBtn = mkButton({
    className: 'mycel-search-btn--toggle mycel-search-btn--text',
    title: 'Match whole word',
    text: 'W',
  });
  const regexBtn = mkButton({
    className: 'mycel-search-btn--toggle mycel-search-btn--text',
    title: 'Use regular expression',
    text: '.*',
  });

  const divider = document.createElement('span');
  divider.className = 'mycel-search-divider';

  const prevBtn = mkButton({ title: 'Previous match (Shift+Enter)', html: icons.up });
  const nextBtn = mkButton({ title: 'Next match (Enter)', html: icons.down });
  const expandBtn = mkButton({
    className: 'mycel-search-expand',
    title: 'Toggle replace',
    html: icons.expand,
  });
  const closeBtn = mkButton({ title: 'Close (Esc)', html: icons.close });

  const searchRow = document.createElement('div');
  searchRow.className = 'mycel-search-row';
  searchRow.append(
    searchField,
    caseBtn,
    wordBtn,
    regexBtn,
    divider,
    prevBtn,
    nextBtn,
    expandBtn,
    closeBtn,
  );

  // ── Replace row ──────────────────────────────────────────────────────
  const replaceField = document.createElement('div');
  replaceField.className = 'mycel-search-field';
  replaceField.innerHTML = `<span class="mycel-search-icon">${icons.replace}</span>`;

  const replaceInput = document.createElement('input');
  replaceInput.type = 'text';
  replaceInput.className = 'mycel-replace-input';
  replaceInput.placeholder = 'Replace with';
  replaceInput.setAttribute('aria-label', 'Replace with');
  replaceField.append(replaceInput);

  const replaceBtn = mkButton({ title: 'Replace next match', text: 'Replace' });
  const replaceAllBtn = mkButton({
    className: 'mycel-search-primary',
    title: 'Replace all matches',
    text: 'All',
  });

  const replaceRow = document.createElement('div');
  replaceRow.className = 'mycel-search-row mycel-replace-row';
  replaceRow.append(replaceField, replaceBtn, replaceAllBtn);

  dom.append(searchRow, replaceRow);

  // ── Query plumbing ───────────────────────────────────────────────────
  const buildQuery = () =>
    new SearchQuery({
      search: searchInput.value,
      caseSensitive,
      regexp,
      wholeWord,
      replace: replaceInput.value,
    });

  const commit = () => {
    view.dispatch({ effects: setSearchQuery.of(buildQuery()) });
    updateCount();
  };

  const updateCount = () => {
    const query = getSearchQuery(view.state);
    if (!searchInput.value) {
      countEl.textContent = '';
      countEl.classList.remove('mycel-search-count--none');
      searchField.classList.remove('mycel-search-field--invalid');
      return;
    }
    if (!query.valid) {
      countEl.textContent = regexp ? 'bad regex' : '0';
      countEl.classList.add('mycel-search-count--none');
      searchField.classList.add('mycel-search-field--invalid');
      return;
    }
    searchField.classList.remove('mycel-search-field--invalid');
    let total = 0;
    let active = 0;
    const sel = view.state.selection.main;
    try {
      const cursor = query.getCursor(view.state) as Iterator<{
        from: number;
        to: number;
      }>;
      let res = cursor.next();
      while (!res.done) {
        total += 1;
        if (res.value.from === sel.from && res.value.to === sel.to) active = total;
        res = cursor.next();
      }
    } catch {
      /* malformed query — counter just shows 0 */
    }
    countEl.textContent = total ? `${active || '–'}/${total}` : 'no results';
    countEl.classList.toggle('mycel-search-count--none', total === 0);
  };

  const toggle = (btn: HTMLButtonElement, get: () => boolean, set: (v: boolean) => void) => {
    btn.addEventListener('click', () => {
      set(!get());
      btn.classList.toggle('is-active', get());
      commit();
      searchInput.focus();
    });
  };
  toggle(caseBtn, () => caseSensitive, (v) => (caseSensitive = v));
  toggle(wordBtn, () => wholeWord, (v) => (wholeWord = v));
  toggle(regexBtn, () => regexp, (v) => (regexp = v));

  searchInput.addEventListener('input', commit);
  replaceInput.addEventListener('input', commit);

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) findPrevious(view);
      else findNext(view);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  });
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      replaceNext(view);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  });

  prevBtn.addEventListener('click', () => {
    findPrevious(view);
    searchInput.focus();
  });
  nextBtn.addEventListener('click', () => {
    findNext(view);
    searchInput.focus();
  });
  replaceBtn.addEventListener('click', () => {
    replaceNext(view);
    searchInput.focus();
  });
  replaceAllBtn.addEventListener('click', () => {
    replaceAll(view);
    searchInput.focus();
  });
  closeBtn.addEventListener('click', () => {
    closeSearchPanel(view);
    view.focus();
  });
  expandBtn.addEventListener('click', () => {
    const open = dom.classList.toggle('mycel-search--replace');
    expandBtn.classList.toggle('is-active', open);
    if (open) replaceInput.focus();
    else searchInput.focus();
  });

  return {
    dom,
    top: true,
    mount() {
      // Seed from an existing query, or the current single-line selection.
      const existing = getSearchQuery(view.state);
      if (existing.search) {
        searchInput.value = existing.search;
        replaceInput.value = existing.replace;
        caseSensitive = existing.caseSensitive;
        regexp = existing.regexp;
        wholeWord = existing.wholeWord;
        caseBtn.classList.toggle('is-active', caseSensitive);
        wordBtn.classList.toggle('is-active', wholeWord);
        regexBtn.classList.toggle('is-active', regexp);
      } else {
        const sel = view.state.selection.main;
        if (
          !sel.empty &&
          view.state.doc.lineAt(sel.from).number === view.state.doc.lineAt(sel.to).number
        ) {
          searchInput.value = view.state.sliceDoc(sel.from, sel.to);
        }
      }
      if (searchInput.value) commit();
      searchInput.focus();
      searchInput.select();
    },
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) updateCount();
    },
  };
}
