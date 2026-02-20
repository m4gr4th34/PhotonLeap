/**
 * Pyodide Web Worker: loads Python runtime, executes trace in-browser.
 * Zero-install architecture - no backend required.
 */
const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.29.3/full/';

importScripts(PYODIDE_CDN + 'pyodide.js');

let pyodide = null;
let traceLoaded = false;

async function loadTraceScript() {
  const base = self.location.href.replace(/[^/]*$/, '');
  try {
    const res = await fetch(base + 'trace.py', { credentials: 'omit' });
    if (res.ok) return await res.text();
  } catch (_) {}
  return `def run_trace(optical_stack):
    return {"error": "Trace script not loaded", "rays": [], "surfaces": [], "focusZ": 0, "bestFocusZ": 0, "metricsSweep": []}`;
}

self.onmessage = async (e) => {
  const { type, id, payload } = e.data || {};
  try {
    if (type === 'init') {
      pyodide = await loadPyodide({ indexURL: PYODIDE_CDN });
      await pyodide.loadPackage(['numpy']);
      const traceScript = await loadTraceScript();
      await pyodide.runPythonAsync(traceScript);
      traceLoaded = true;
      self.postMessage({ type: 'ready' });
      return;
    }
    if (type === 'trace' && traceLoaded && pyodide) {
      const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      const code = `
import json
import base64
__payload__ = json.loads(base64.b64decode("${b64}").decode())
__result__ = run_trace(__payload__)
__result__
`;
      const result = await pyodide.runPythonAsync(code);
      const jsResult = result?.toJs ? result.toJs() : (result ?? {});
      self.postMessage({ type: 'trace', id, result: jsResult });
      return;
    }
    if (type === 'ping') {
      self.postMessage({ type: 'ping', ok: true });
      return;
    }
  } catch (err) {
    const msg = err?.message || String(err);
    if (type === 'trace') {
      self.postMessage({ type: 'trace', id, result: null, error: msg });
    } else {
      self.postMessage({ type: 'ready', error: msg });
    }
  }
};
