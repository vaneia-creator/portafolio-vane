// Ajustes y contadores diarios (localStorage) + base de datos local (IndexedDB).
// Las claves de API se guardan solo en este navegador y se envían únicamente a su proveedor.

import { DEFAULT_THRESHOLDS, DEFAULT_MODELS, DAILY_LIMITS } from '../core/config.js';

const LS_SETTINGS = 'radar.settings.v1';
const LS_COUNTERS = 'radar.counters.v1';

const readLS = (k, def) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; }
};
const writeLS = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* almacenamiento no disponible */ }
};

export function getSettings() {
  const s = readLS(LS_SETTINGS, {});
  return {
    keys: { apify: '', groq: '', youtube: '', gemini: '', openrouter: '', ...(s.keys || {}) },
    models: { ...DEFAULT_MODELS, ...(s.models || {}) },
    thresholds: { ...DEFAULT_THRESHOLDS, ...(s.thresholds || {}) },
    currentProject: s.currentProject || null,
    captura: { reelsPorCuenta: 20, topAnalizar: 5, ...(s.captura || {}) },
  };
}
export function saveSettings(patch) {
  const s = { ...getSettings(), ...patch };
  writeLS(LS_SETTINGS, s);
  return s;
}

const hoy = () => new Date().toISOString().slice(0, 10); // los cupos se cuentan por día UTC

export function getCounters() {
  const c = readLS(LS_COUNTERS, {});
  return c.dia === hoy() ? c : { dia: hoy(), uso: {} };
}
/** Suma consumo: bump('groq_llm', { requests: 1, tokens: 1234 }) */
export function bump(proveedor, delta) {
  const c = getCounters();
  const u = (c.uso[proveedor] ||= {});
  for (const [k, v] of Object.entries(delta)) u[k] = (u[k] || 0) + v;
  writeLS(LS_COUNTERS, c);
}
/** Devuelve un mensaje si el contador local ya alcanzó el límite diario del proveedor; si no, null. */
export function overLimit(proveedor, extra = {}) {
  const lim = DAILY_LIMITS[proveedor];
  if (!lim) return null;
  const uso = getCounters().uso[proveedor] || {};
  for (const [k, max] of Object.entries(lim)) {
    if ((uso[k] || 0) + (extra[k] || 0) > max) return `Límite diario de ${proveedor} alcanzado (${k}: ${uso[k] || 0} de ${max}).`;
  }
  return null;
}

// ---------- IndexedDB ----------
const DB_NAME = 'radar-dolores-reels';
const TABLES = ['projects', 'creators', 'reels', 'metric_snapshots', 'transcripts', 'annotations', 'comments', 'pain_mentions', 'pain_clusters', 'outputs', 'trends', 'runs'];
let dbPromise = null;

function open() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const t of TABLES) {
        const os = req.result.createObjectStore(t, { keyPath: 'id' });
        os.createIndex('project_id', 'project_id', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('No se pudo abrir el almacenamiento local del navegador (IndexedDB).'));
  });
  return dbPromise;
}

function tx(tables, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(tables, mode);
    let out;
    t.oncomplete = () => resolve(out);
    t.onerror = t.onabort = () => reject(t.error || new Error('Error de almacenamiento local.'));
    out = fn(t);
  }));
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  TABLES,
  async get(table, id) { const d = await open(); return reqP(d.transaction(table).objectStore(table).get(id)); },
  async all(table) { const d = await open(); return reqP(d.transaction(table).objectStore(table).getAll()); },
  async byProject(table, projectId) { const d = await open(); return reqP(d.transaction(table).objectStore(table).index('project_id').getAll(projectId)); },
  put(table, rows) {
    const list = Array.isArray(rows) ? rows : [rows];
    return tx([table], 'readwrite', (t) => { const os = t.objectStore(table); for (const r of list) os.put(r); });
  },
  del(table, ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    return tx([table], 'readwrite', (t) => { const os = t.objectStore(table); for (const id of list) os.delete(id); });
  },
  async deleteProject(projectId) {
    for (const t of TABLES) {
      if (t === 'projects') continue;
      const rows = await this.byProject(t, projectId);
      if (rows.length) await this.del(t, rows.map((r) => r.id));
    }
    await this.del('projects', projectId);
  },
  async exportAll() {
    const out = { app: 'radar-dolores-reels', version: 1, exportado: new Date().toISOString(), tablas: {} };
    for (const t of TABLES) out.tablas[t] = await this.all(t);
    return out;
  },
  async importAll(data) {
    if (data?.app !== 'radar-dolores-reels' || !data.tablas) throw new Error('El archivo no es un respaldo de esta app.');
    let n = 0;
    for (const t of TABLES) {
      const rows = (data.tablas[t] || []).filter((r) => r && r.id != null);
      if (rows.length) { await this.put(t, rows); n += rows.length; }
    }
    return n;
  },
};

export const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
