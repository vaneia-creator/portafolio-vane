// Arranque de la app: navegación, proyecto activo y registro de actividad.

import { h, btn } from './ui/dom.js';
import { db, getSettings, saveSettings, pedirPersistencia } from './services/store.js';
import { viewConfig } from './ui/view-config.js';
import { viewProject } from './ui/view-project.js';
import { viewReels } from './ui/view-reels.js';
import { viewPains } from './ui/view-pains.js';
import { viewGenerator } from './ui/view-generator.js';
import { viewReport } from './ui/view-report.js';
import { viewLibrary } from './ui/view-library.js';
import { descargarCopia } from './ui/view-config.js';

const TABS = [
  { id: 'proyecto', nombre: '1 · Proyecto', view: viewProject },
  { id: 'reels', nombre: '2 · Reels virales', view: viewReels, needsProject: true },
  { id: 'dolores', nombre: '3 · Dolores', view: viewPains, needsProject: true },
  { id: 'generador', nombre: '4 · Ofertas y guiones', view: viewGenerator, needsProject: true },
  { id: 'informe', nombre: '5 · Informe', view: viewReport, needsProject: true },
  { id: 'biblioteca', nombre: 'Biblioteca', view: viewLibrary },
  { id: 'config', nombre: 'Configuración', view: viewConfig },
];

const $ = (id) => document.getElementById(id);
const logEl = $('activityLog');
const stateEl = $('activityState');

export const app = {
  project: null,
  tab: 'proyecto',
  state: {}, // estado de interfaz por pestaña (reel abierto, consultas en edición…)

  log(msg, cls = '') {
    const hora = new Date().toLocaleTimeString('es-ES');
    logEl.append(h('li', { class: cls }, `${hora}  ${msg}`));
    while (logEl.children.length > 300) logEl.firstChild.remove();
    logEl.scrollTop = logEl.scrollHeight;
    stateEl.textContent = msg;
  },

  /** Ejecuta una tarea larga: bloquea botones, registra el progreso y muestra los errores tal cual. */
  async run(titulo, fn) {
    if (document.body.classList.contains('busy')) return;
    document.body.classList.add('busy');
    app.log(`▶ ${titulo}`);
    try {
      const r = await fn((m) => app.log(m));
      app.log(`✔ ${titulo}: terminado.`, 'done');
      return r;
    } catch (err) {
      console.error(err);
      app.log(`✖ ${titulo}: ${err.message}`, 'err');
      $('activity').classList.add('open');
      $('activityToggle').setAttribute('aria-expanded', 'true');
    } finally {
      try { await app.render(); } finally { document.body.classList.remove('busy'); }
    }
  },

  async setProject(id) {
    app.project = id ? await db.get('projects', id) : null;
    saveSettings({ currentProject: app.project?.id || null });
    app.state = {};
    await app.render();
  },

  go(tab) { app.tab = tab; location.hash = tab; return app.render(); },

  async render() {
    const projects = (await db.all('projects')).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const sel = $('projectSel');
    sel.replaceChildren(
      h('option', { value: '' }, projects.length ? '— elige un proyecto —' : '— sin proyectos —'),
      ...projects.map((p) => h('option', { value: p.id, selected: p.id === app.project?.id }, p.tema)),
    );
    const tab = TABS.find((t) => t.id === app.tab) || TABS[0];
    $('tabs').replaceChildren(...TABS.map((t) => h('button', { type: 'button', 'aria-current': t.id === tab.id ? 'page' : null, onclick: () => app.go(t.id) }, t.nombre)));
    const view = $('view');
    let nodes;
    if (tab.needsProject && !app.project) {
      nodes = [h('section', { class: 'card' }, h('h2', {}, 'Primero crea o elige un proyecto'),
        h('p', { class: 'hint' }, 'Un proyecto es un tema de investigación con sus referentes.'),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => app.go('proyecto') }, 'Ir a Proyecto')))];
    } else {
      try { nodes = await tab.view(app); }
      catch (err) { console.error(err); nodes = [h('section', { class: 'card' }, h('h2', {}, 'Error al mostrar esta sección'), h('p', { class: 'note bad' }, err.message))]; }
    }
    const aviso = await avisoCopia(tab.id);
    view.replaceChildren(...(aviso ? [aviso] : []), ...nodes);
  },
};

/** Recordatorio de copia: si hay material y no se ha descargado una copia en 7 días. */
async function avisoCopia(tabId) {
  if (tabId === 'config') return null;
  const s = getSettings();
  const dias = s.ultimoRespaldo ? (Date.now() - Date.parse(s.ultimoRespaldo)) / 86400000 : Infinity;
  if (dias < 7) return null;
  let n = 0;
  try { n = await db.count('transcripts') + await db.count('outputs'); } catch { return null; }
  if (!n) return null;
  return h('div', { class: 'note warn noprint' },
    `Tienes ${n} análisis y guiones guardados en este navegador. ${s.ultimoRespaldo ? 'Hace más de una semana que no descargas una copia.' : 'Aún no tienes ninguna copia fuera del navegador.'} `,
    btn('Descargar copia completa', () => descargarCopia(app), 'small'));
}

$('projectSel').addEventListener('change', (e) => app.setProject(e.target.value));
$('activityToggle').addEventListener('click', () => {
  const open = $('activity').classList.toggle('open');
  $('activityToggle').setAttribute('aria-expanded', String(open));
});
window.addEventListener('hashchange', () => {
  const t = location.hash.slice(1);
  if (t && t !== app.tab && TABS.some((x) => x.id === t)) { app.tab = t; app.render(); }
});

(async function init() {
  pedirPersistencia(); // pide al navegador que no borre los datos de la app al liberar espacio
  const s = getSettings();
  const inicial = location.hash.slice(1);
  if (TABS.some((t) => t.id === inicial)) app.tab = inicial;
  else if (!s.keys.apify || !s.keys.groq) app.tab = 'config';
  try {
    if (s.currentProject) app.project = (await db.get('projects', s.currentProject)) || null;
  } catch (err) { app.log(err.message, 'err'); }
  await app.render();
})();
