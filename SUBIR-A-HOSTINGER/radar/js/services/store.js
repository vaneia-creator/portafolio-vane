// Ajustes y contadores diarios (localStorage) + base de datos local (IndexedDB).
// Las claves de API se guardan solo en este navegador y se envían únicamente a su proveedor.

import { DEFAULT_THRESHOLDS, DEFAULT_MODELS, DAILY_LIMITS } from '../core/config.js';

const LS_SETTINGS = 'radar.settings.v1';
const LS_COUNTERS = 'radar.counters.v1';

const readLS = (k, def) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; }
};
const writeLS = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
};

/** ¿Este navegador conserva lo guardado? (falla en modo incógnito estricto o con el almacenamiento bloqueado) */
export function storageOk() {
  try { localStorage.setItem('radar.test', '1'); const ok = localStorage.getItem('radar.test') === '1'; localStorage.removeItem('radar.test'); return ok; }
  catch { return false; }
}
/** Pide al navegador que no borre los datos de la app al liberar espacio. */
export function pedirPersistencia() { try { navigator.storage?.persist?.(); } catch { /* no disponible */ } }

export function getSettings() {
  const s = readLS(LS_SETTINGS, {});
  return {
    keys: { apify: '', groq: '', youtube: '', gemini: '', openrouter: '', ...(s.keys || {}) },
    models: { ...DEFAULT_MODELS, ...(s.models || {}) },
    thresholds: { ...DEFAULT_THRESHOLDS, ...(s.thresholds || {}) },
    currentProject: s.currentProject || null,
    captura: { reelsPorCuenta: 20, topAnalizar: 5, ...(s.captura || {}) },
    guardarVideos: s.guardarVideos !== false,
    ultimoRespaldo: s.ultimoRespaldo || null,
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
// La versión 2 solo AÑADE la tabla de videos: las tablas existentes y sus datos no se tocan.
const DATA_TABLES = ['projects', 'creators', 'reels', 'metric_snapshots', 'transcripts', 'annotations', 'comments', 'pain_mentions', 'pain_clusters', 'outputs', 'trends', 'runs'];
const TABLES = [...DATA_TABLES, 'videos'];
let dbPromise = null;

function open() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      for (const t of TABLES) {
        if (req.result.objectStoreNames.contains(t)) continue;
        const os = req.result.createObjectStore(t, { keyPath: 'id' });
        os.createIndex('project_id', 'project_id', { unique: false });
      }
    };
    req.onblocked = () => reject(new Error('Cierra las demás pestañas de esta app y recarga: hay una actualización del almacenamiento pendiente.'));
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
  async keys(table) { const d = await open(); return reqP(d.transaction(table).objectStore(table).getAllKeys()); },
  async count(table) { const d = await open(); return reqP(d.transaction(table).objectStore(table).count()); },
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
  /** Todos los datos (sin los videos, que van aparte en la copia completa). */
  async exportAll() {
    const out = { app: 'radar-dolores-reels', version: 2, exportado: new Date().toISOString(), tablas: {} };
    for (const t of DATA_TABLES) out.tablas[t] = await this.all(t);
    return out;
  },
  /** Fusiona un respaldo con lo que ya hay: nunca borra; si un registro existe, lo actualiza. */
  async importAll(data) {
    if (data?.app !== 'radar-dolores-reels' || !data.tablas) throw new Error('El archivo no es un respaldo de esta app.');
    let n = 0;
    for (const t of DATA_TABLES) {
      const rows = (data.tablas[t] || []).filter((r) => r && r.id != null);
      if (rows.length) { await this.put(t, rows); n += rows.length; }
    }
    return n;
  },
};

/** Copia completa en un ZIP: datos.json + cada video guardado como .mp4. */
export async function exportZip(onLog) {
  const { makeZip } = await import('./zip.js');
  const data = await db.exportAll();
  const videos = await db.all('videos');
  const files = [];
  data.videos = [];
  for (const v of videos) {
    const archivo = `videos/${String(v.id).replace(/[^\w.-]+/g, '_')}.mp4`;
    data.videos.push({ id: v.id, project_id: v.project_id, reel_id: v.reel_id, type: v.type, size: v.size, guardado: v.guardado, archivo });
    files.push({ name: archivo, data: new Uint8Array(await v.blob.arrayBuffer()) });
  }
  onLog?.(`Empaquetando ${videos.length} video(s)…`);
  files.unshift({ name: 'datos.json', data: new TextEncoder().encode(JSON.stringify(data)) });
  return makeZip(files);
}

/** Importa una copia (.zip completa o .json de datos). Fusiona sin borrar nada. */
export async function importBackup(file) {
  if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
    const { readZip } = await import('./zip.js');
    const entries = await readZip(await file.arrayBuffer());
    const datos = entries.find((e) => e.name === 'datos.json');
    if (!datos) throw new Error('El ZIP no contiene datos.json: no es una copia de esta app.');
    const data = JSON.parse(new TextDecoder().decode(datos.data));
    const n = await db.importAll(data);
    let v = 0;
    for (const meta of data.videos || []) {
      const e = entries.find((x) => x.name === meta.archivo);
      if (!e) continue;
      await db.put('videos', { id: meta.id, project_id: meta.project_id, reel_id: meta.reel_id, type: meta.type, size: e.data.length, guardado: meta.guardado, blob: new Blob([e.data], { type: meta.type || 'video/mp4' }) });
      v++;
    }
    return { registros: n, videos: v };
  }
  return { registros: await db.importAll(JSON.parse(await file.text())), videos: 0 };
}

export const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
