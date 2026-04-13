/* ═══════════════════════════════════════════════════
   app.js  —  DxP Project Site
   ═══════════════════════════════════════════════════ */

// ── Globals ───────────────────────────────────────────────────────────────
let pyodide        = null;
let pyodideLoading = false;
let pyodideReady   = false;

const editors   = [];   // CodeMirror instances
const originals = [];   // original source text per block

const PYTHON_TABS = new Set(['demo', 'details']);


// ══════════════════════════════════════════════════════════════════════════
//  TAB SWITCHING IN BROWSER
// ══════════════════════════════════════════════════════════════════════════
function initTabs() {
  const btns   = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;

      btns.forEach(b => b.classList.toggle('active', b === btn));
      panels.forEach(p => p.classList.toggle('active', p.id === 'tab-' + target));

      // Refresh editors so CodeMirror renders correctly after being hidden
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
//  PYODIDE INIT
// ══════════════════════════════════════════════════════════════════════════
async function initPyodide() {
  if (pyodideLoading || pyodideReady) return;
  pyodideLoading = true;

  const dot        = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  // No full-page overlay — just update the status badge while loading in background
  dot.className        = 'status-dot';   // yellow pulse
  statusText.textContent = 'Loading Python…';
  document.querySelectorAll('.btn-run').forEach(b => b.disabled = true);

  try {
    statusText.textContent = 'Loading runtime…';
    pyodide = await loadPyodide();

    statusText.textContent = 'Installing packages…';
    await pyodide.loadPackage(['numpy', 'pandas']);
    await pyodide.loadPackage('matplotlib');

    // Patch savefig so plt.savefig("__plot__") captures a PNG as base64
    await pyodide.runPythonAsync(`
import sys, io, base64
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as _plt_orig

_captured_figures = []

_orig_savefig = _plt_orig.savefig
def _patched_savefig(fname, *args, **kwargs):
    if fname == "__plot__":
        buf = io.BytesIO()
        kwargs.setdefault("format", "png")
        kwargs.setdefault("bbox_inches", "tight")
        _orig_savefig(buf, *args, **kwargs)
        _captured_figures.append(base64.b64encode(buf.getvalue()).decode())
    else:
        _orig_savefig(fname, *args, **kwargs)

_plt_orig.savefig = _patched_savefig
`);

    pyodideReady   = true;
    pyodideLoading = false;

    dot.className          = 'status-dot ready';
    statusText.textContent = 'Python ready';
    document.querySelectorAll('.btn-run').forEach(b => b.disabled = false);

  } catch (err) {
    pyodideLoading = false;
    dot.style.background   = 'var(--red)';
    dot.style.animation    = 'none';
    statusText.textContent = 'Load failed — refresh to retry';

    // Re-enable page interaction even on failure
    document.querySelectorAll('.btn-run').forEach(b => b.disabled = false);
    console.error('Pyodide failed to load:', err);
  }
}


// ══════════════════════════════════════════════════════════════════════════
//  RUN PYTHON CODE
// ══════════════════════════════════════════════════════════════════════════
function getBlockIndex(btn) {
  return parseInt(btn.closest('.code-block').dataset.editorIdx, 10);
}

function runBlock(btn) {
  runBlockByIndex(getBlockIndex(btn));
}

async function runBlockByIndex(idx) {
  if (!pyodideReady) return;

  const block   = document.querySelectorAll('.code-block')[idx];
  const btn     = block.querySelector('.btn-run');
  const output  = block.querySelector('.output-area');
  const outText = block.querySelector('.output-text');
  const outImgs = block.querySelector('.output-images');
  const timing  = block.querySelector('.timing');
  const code    = editors[idx].getValue();

  btn.disabled        = true;
  btn.textContent     = '⏳ Running';
  output.classList.remove('hidden');
  outText.textContent = '';
  outText.className   = 'output-text';
  if (outImgs) outImgs.innerHTML = '';

  let captured = '';
  pyodide.setStdout({ batched: s => { captured += s + '\n'; } });
  pyodide.setStderr({ batched: s => { captured += '[stderr] ' + s + '\n'; } });

  await pyodide.runPythonAsync('_captured_figures.clear()');

  const t0 = performance.now();
  try {
    await pyodide.runPythonAsync(code);
    timing.textContent  = (performance.now() - t0).toFixed(0) + ' ms';
    outText.textContent = captured.trimEnd();

    if (outImgs) {
      const figs = pyodide.globals.get('_captured_figures').toJs();
      figs.forEach(b64 => {
        const img = document.createElement('img');
        img.src   = 'data:image/png;base64,' + b64;
        outImgs.appendChild(img);
      });
    }
  } catch (err) {
    timing.textContent  = (performance.now() - t0).toFixed(0) + ' ms';
    outText.textContent = captured + '\n' + err.message;
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
  initPyodide();
});
