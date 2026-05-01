/* ═══════════════════════════════════════════════════
   app.js  —  DxP Project Site
   ═══════════════════════════════════════════════════ */

const SERVER = 'http://localhost:8080';

const editors   = [];   // CodeMirror instances
const originals = [];   // original source text per block

const PYTHON_TABS = new Set(['demo', 'details']);


// ══════════════════════════════════════════════════════════════════════════
//  TAB SWITCHING
// ══════════════════════════════════════════════════════════════════════════
function initTabs() {
  const btns   = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      btns.forEach(b   => b.classList.toggle('active', b === btn));
      panels.forEach(p => p.classList.toggle('active', p.id === 'tab-' + target));
      if (PYTHON_TABS.has(target)) {
        editors.forEach(cm => cm && cm.refresh());
      }
    });
  });
}


// ══════════════════════════════════════════════════════════════════════════
//  CODEMIRROR SETUP
// ══════════════════════════════════════════════════════════════════════════
function initEditors() {
  document.querySelectorAll('textarea.py-src').forEach((ta, idx) => {
    originals[idx] = ta.value;

    const cm = CodeMirror.fromTextArea(ta, {
      mode:              'python',
      theme:             'dracula',
      lineNumbers:       true,
      matchBrackets:     true,
      autoCloseBrackets: true,
      indentUnit:        4,
      tabSize:           4,
      indentWithTabs:    false,
      viewportMargin:    Infinity,
      extraKeys: {
        'Ctrl-Enter': () => runBlockByIndex(idx),
        'Tab': cm => {
          if (cm.somethingSelected()) cm.indentSelection('add');
          else cm.replaceSelection('    ', 'end');
        }
      }
    });

    cm.getWrapperElement()
      .closest('.code-block')
      .dataset.editorIdx = idx;

    editors[idx] = cm;
  });
}


// ══════════════════════════════════════════════════════════════════════════
//  RUN PYTHON CODE — sends to server, gets stdout back
// ══════════════════════════════════════════════════════════════════════════
function getBlockIndex(btn) {
  return parseInt(btn.closest('.code-block').dataset.editorIdx, 10);
}

function runBlock(btn) {
  runBlockByIndex(getBlockIndex(btn));
}

async function runBlockByIndex(idx) {
  const block      = document.querySelectorAll('.code-block')[idx];
  const btn        = block.querySelector('.btn-run');
  const output     = block.querySelector('.output-area');
  const outText    = block.querySelector('.output-text');
  const outImgs    = block.querySelector('.output-images');
  const timing     = block.querySelector('.timing');
  const noteInput  = block.querySelector('.field-note-input');
  const code       = editors[idx].getValue();
  const field_note = noteInput ? noteInput.value.trim() : '';

  btn.disabled        = true;
  btn.textContent     = '⏳ Running';
  output.classList.remove('hidden');
  outText.textContent = '';
  outText.className   = 'output-text';
  if (outImgs) outImgs.innerHTML = '';

  const t0 = performance.now();
  try {
    const resp = await fetch(`${SERVER}/run`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code, field_note }),
    });
    const data = await resp.json();
    timing.textContent  = (performance.now() - t0).toFixed(0) + ' ms';

    if (data.error) {
      outText.textContent = data.error;
      outText.className   = 'output-text error';
    } else {
      outText.textContent = data.output || '(no output)';
    }
  } catch (err) {
    timing.textContent  = (performance.now() - t0).toFixed(0) + ' ms';
    outText.textContent = 'Could not reach server: ' + err.message;
    outText.className   = 'output-text error';
  }

  btn.disabled  = false;
  btn.innerHTML = '▶ Run';
}


// ══════════════════════════════════════════════════════════════════════════
//  CLEAR / RESET
// ══════════════════════════════════════════════════════════════════════════
function clearOutput(btn) {
  const block   = btn.closest('.code-block');
  const output  = block.querySelector('.output-area');
  const outText = block.querySelector('.output-text');
  const outImgs = block.querySelector('.output-images');
  outText.textContent = '';
  outText.className   = 'output-text';
  if (outImgs) outImgs.innerHTML = '';
  output.classList.add('hidden');
}

function resetEditor(btn) {
  const idx = getBlockIndex(btn);
  editors[idx].setValue(originals[idx]);
  clearOutput(btn);
}


// ══════════════════════════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initEditors();

  // Update status badge to show server-mode (no loading needed)
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if (dot && text) {
    dot.className    = 'status-dot ready';
    text.textContent = 'Ready';
  }
});
