/**
 * Pyodide Web Worker: loads Python runtime, executes trace in-browser.
 * Zero-install architecture - no backend required.
 */
const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.29.3/full/';

importScripts(PYODIDE_CDN + 'pyodide.js');

let pyodide = null;
let traceLoaded = false;

async function loadTraceScript() {
  // Worker location is the script URL; derive trace.py from same directory.
  const scriptUrl = self.location.href;
  const base = scriptUrl.replace(/[^/]*$/, '');
  const traceUrl = base + 'trace.py?v=8';
  try {
    const res = await fetch(traceUrl, { credentials: 'omit', cache: 'no-store' });
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
      pyodide.setStdout({
        batched: (msg) =>
          self.postMessage({ type: 'log', lines: msg ? [String(msg).trimEnd()] : [] }),
      });
      await pyodide.loadPackage(['numpy']);
      const traceScript = await loadTraceScript();
      await pyodide.runPythonAsync(traceScript);
      traceLoaded = true;
      self.postMessage({ type: 'ready' });
      return;
    }
    if (type === 'chromatic-shift' && traceLoaded && pyodide) {
      const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      const wmin = payload.wavelength_min_nm ?? 400;
      const wmax = payload.wavelength_max_nm ?? 1100;
      const wstep = payload.wavelength_step_nm ?? 10;
      const code = `
import json
import base64
__payload__ = json.loads(base64.b64decode("${b64}").decode())
__result__ = run_chromatic_shift(__payload__, wavelength_min_nm=${wmin}, wavelength_max_nm=${wmax}, wavelength_step_nm=${wstep})
__result__
`;
      const runChromatic = pyodide.runPythonAsync(code);
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Chromatic shift timed out after 30s')), 30000)
      );
      const result = await Promise.race([runChromatic, timeout]);
      const jsResult = result?.toJs ? result.toJs() : (result ?? []);
      self.postMessage({ type: 'chromatic-shift', id, result: jsResult });
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
      const TRACE_TIMEOUT_MS = 15000;
      const runTrace = pyodide.runPythonAsync(code);
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Trace timed out after 15s')), TRACE_TIMEOUT_MS)
      );
      const result = await Promise.race([runTrace, timeout]);
      const jsResult = result?.toJs ? result.toJs() : (result ?? {});
      const refLog = jsResult?.refractionLog;
      if (refLog && Array.isArray(refLog) && refLog.length > 0) {
        const lines = refLog.map((e) => {
          const ui = e.ui_surf ?? e.surf + 1;
          const z = e.z_vertex ?? 0;
          const mat = e.mat_name ?? '?';
          const n2 = e.n2 ?? 0;
          return `MATCH AUDIT | UI Surface ${ui} | Pos: ${Number(z).toFixed(2)}mm | Material: ${mat} | n_after: ${Number(n2).toFixed(4)}`;
        });
        self.postMessage({ type: 'log', lines: ['[Trace refraction audit]', ...lines] });
      }
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
    } else if (type === 'chromatic-shift') {
      self.postMessage({ type: 'chromatic-shift', id, result: null, error: msg });
    } else {
      self.postMessage({ type: 'ready', error: msg });
    }
  }
};
