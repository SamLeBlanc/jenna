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

    await patchPyodideInput();
    await injectKeyBERT();
    await injectAnthropic();
    await pyodide.runPythonAsync(`
import sys, types

_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **kw: None
sys.modules["dotenv"] = _dotenv_mod

_typer_mod = types.ModuleType("typer")
_typer_mod.echo = print
sys.modules["typer"] = _typer_mod
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
//  INPUT() MODAL — intercepts Python's input() calls in Pyodide
// ══════════════════════════════════════════════════════════════════════════

// Inject the modal HTML once into the page
(function createInputModal() {
  const modal = document.createElement('div');
  modal.id = 'py-input-modal';
  modal.innerHTML = `
    <div id="py-input-backdrop"></div>
    <div id="py-input-box">
      <label id="py-input-label" for="py-input-field"></label>
      <input id="py-input-field" type="text" autocomplete="off" spellcheck="false"/>
      <div id="py-input-actions">
        <button id="py-input-submit">Submit</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const style = document.createElement('style');
  style.textContent = `
    #py-input-modal { display: none; position: fixed; inset: 0; z-index: 9999; }
    #py-input-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
    #py-input-box {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
      background: #282a36; border: 1px solid #6272a4; border-radius: 8px;
      padding: 24px 28px; min-width: 320px; max-width: 480px; width: 90%;
      display: flex; flex-direction: column; gap: 12px;
    }
    #py-input-label { color: #f8f8f2; font-family: monospace; font-size: .95rem; white-space: pre-wrap; }
    #py-input-field {
      background: #1e1f29; color: #f8f8f2; border: 1px solid #6272a4;
      border-radius: 4px; padding: 8px 10px; font-family: monospace;
      font-size: .95rem; outline: none;
    }
    #py-input-field:focus { border-color: #bd93f9; }
    #py-input-actions { display: flex; justify-content: flex-end; }
    #py-input-submit {
      background: #bd93f9; color: #282a36; border: none; border-radius: 4px;
      padding: 7px 20px; font-size: .9rem; font-weight: 600; cursor: pointer;
    }
    #py-input-submit:hover { background: #cfa9ff; }
  `;
  document.head.appendChild(style);
})();

// Returns a Promise that resolves with the user's typed value
function promptUser(promptText) {
  return new Promise(resolve => {
    const modal  = document.getElementById('py-input-modal');
    const label  = document.getElementById('py-input-label');
    const field  = document.getElementById('py-input-field');
    const submit = document.getElementById('py-input-submit');

    label.textContent = promptText || '';
    field.value = '';
    modal.style.display = 'block';
    field.focus();

    function finish() {
      modal.style.display = 'none';
      submit.removeEventListener('click', finish);
      field.removeEventListener('keydown', onKey);
      resolve(field.value);
    }
    function onKey(e) { if (e.key === 'Enter') finish(); }

    submit.addEventListener('click', finish);
    field.addEventListener('keydown', onKey);
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  KEYBERT SHIM — fake keybert module that calls the local Flask server
// ══════════════════════════════════════════════════════════════════════════
async function injectKeyBERT() {
  await pyodide.runPythonAsync(`
import sys, types, json
import pyodide.http

# Build a fake 'keybert' module
_keybert_mod = types.ModuleType("keybert")

class KeyBERT:
    def __init__(self, model=None):
        pass

    async def extract_keywords(self, doc, candidates=None, top_n=5, **kwargs):
        payload = json.dumps({"doc": doc, "candidates": candidates, "top_n": top_n})
        response = await pyodide.http.pyfetch(
            "http://localhost:5050/extract",
            method="POST",
            headers={"Content-Type": "application/json"},
            body=payload
        )
        data = await response.json()
        return [(item["keyword"], item["score"]) for item in data["keywords"]]

_keybert_mod.KeyBERT = KeyBERT
sys.modules["keybert"] = _keybert_mod
`);
}


// ══════════════════════════════════════════════════════════════════════════
//  ANTHROPIC SHIM — fake anthropic module that proxies Claude calls to server
// ══════════════════════════════════════════════════════════════════════════
async function injectAnthropic() {
  await pyodide.runPythonAsync(`
import sys, types, json
import pyodide.http

_anthropic_mod = types.ModuleType("anthropic")

class _Messages:
    async def create(self, model="claude-sonnet-4-6", max_tokens=1024, system="", messages=None, **kwargs):
        payload = json.dumps({
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": messages or []
        })
        response = await pyodide.http.pyfetch(
            "http://localhost:5050/claude",
            method="POST",
            headers={"Content-Type": "application/json"},
            body=payload
        )
        data = await response.json()

        if "error" in data:
            raise Exception(f"Claude error: {data['error']}")

        # Mimic anthropic's response object
        class _Content:
            def __init__(self, text): self.text = text
        class _Message:
            def __init__(self, text): self.content = [_Content(text)]
        return _Message(data["text"])

class Anthropic:
    def __init__(self, api_key=None):
        self.messages = _Messages()

_anthropic_mod.Anthropic = Anthropic
sys.modules["anthropic"] = _anthropic_mod
`);
}


// Patch Pyodide's builtins so input() calls promptUser()
// Strategy: make input() an async def; wrap runPythonAsync so it injects
// an awaited call before user code runs — simpler: rewrite input as async
// and tell users to await it. Instead, we use a synchronous browser prompt
// as fallback when Atomics.wait is unavailable, or intercept at the JS layer.

// Simplest reliable approach: override input() as an async Python function,
// and patch runPythonAsync to auto-await any input() calls by running the
// entire block as a coroutine (which runPythonAsync already does).
async function patchPyodideInput() {
  pyodide.globals.set('_js_prompt', promptUser);
  await pyodide.runPythonAsync(`
import builtins

async def _async_input(prompt=""):
    result = await _js_prompt(str(prompt))
    return result

builtins.input = _async_input
`);
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
    // Auto-insert `await` before async calls so users can write them normally
    const patchedCode = code
      .replace(/\binput\s*\(/g, 'await input(')
      .replace(/\b(\w+)\.extract_keywords\s*\(/g, 'await $1.extract_keywords(')
      .replace(/\b(\w+)\.messages\.create\s*\(/g, 'await $1.messages.create(');
    await pyodide.runPythonAsync(patchedCode);
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
