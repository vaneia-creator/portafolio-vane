// Biblioteca: todos los reels de todos los proyectos, con lo que se sabe de cada uno.

import { h, btn, input, fmt, table, link, empty, download, toCSV } from './dom.js';
import { db } from '../services/store.js';
import { renderOutput } from './view-generator.js';
import { NETWORKS } from '../core/config.js';

export async function viewLibrary(app) {
  const [projects, creators, reels, trans, outputs, videoIds] = await Promise.all([
    db.all('projects'), db.all('creators'), db.all('reels'), db.all('transcripts'), db.all('outputs'), db.keys('videos'),
  ]);
  const proj = new Map(projects.map((p) => [p.id, p]));
  const cre = new Map(creators.map((c) => [c.id, c]));
  const tr = new Map(trans.map((t) => [t.reel_id, t]));
  const conVideo = new Set(videoIds);
  const versiones = new Map();
  for (const o of outputs) if (o.tipo === 'espejo') versiones.set(o.reel_id, (versiones.get(o.reel_id) || 0) + 1);
  const st = (app.state.lib ||= { q: '', filtro: 'todos', orden: 'vistas' });

  const filas = reels.map((r) => {
    const t = tr.get(r.id);
    const c = cre.get(r.creator_id);
    return { r, t, c, p: proj.get(r.project_id), video: conVideo.has(r.id), versiones: versiones.get(r.id) || 0,
      ratio: c?.followers && r.views != null ? r.views / c.followers : null,
      texto: [r.caption, c?.handle, t?.texto, t?.visual?.que_ensena, t?.visual?.formato, ...(t?.visual?.herramientas || []).map((x) => x.nombre)].filter(Boolean).join(' ').toLowerCase() };
  });
  const FILTROS = {
    todos: ['Todos', () => true],
    analizados: ['Analizados (visual o audio)', (f) => !!f.t],
    visual: ['Con análisis toma a toma', (f) => !!f.t?.visual],
    video: ['Con video guardado', (f) => f.video],
    version: ['Con versión creada', (f) => f.versiones > 0],
    datos: ['Solo cifras (sin analizar)', (f) => !f.t],
  };
  const q = st.q.trim().toLowerCase();
  const vis = filas.filter((f) => FILTROS[st.filtro][1](f) && (!q || q.split(/\s+/).every((w) => f.texto.includes(w))))
    .sort((a, b) => (st.orden === 'ratio' ? (b.ratio ?? -1) - (a.ratio ?? -1) : st.orden === 'fecha' ? String(b.r.posted_at).localeCompare(String(a.r.posted_at)) : (b.r.views ?? -1) - (a.r.views ?? -1)));

  const buscar = input({ value: st.q, placeholder: 'Busca en captions, transcripciones, herramientas, cuentas…', 'aria-label': 'Buscar' });
  buscar.addEventListener('change', () => { st.q = buscar.value; app.render(); });
  buscar.addEventListener('keydown', (e) => { if (e.key === 'Enter') { st.q = buscar.value; app.render(); } });
  const filtro = h('select', { 'aria-label': 'Filtro' }, Object.entries(FILTROS).map(([k, [n]]) => h('option', { value: k, selected: st.filtro === k }, `${n} (${filas.filter(FILTROS[k][1]).length})`)));
  filtro.addEventListener('change', () => { st.filtro = filtro.value; app.render(); });
  const orden = h('select', { 'aria-label': 'Orden' }, [['vistas', 'Más vistas'], ['ratio', 'Más vistas por seguidor'], ['fecha', 'Más recientes']].map(([k, n]) => h('option', { value: k, selected: st.orden === k }, n)));
  orden.addEventListener('change', () => { st.orden = orden.value; app.render(); });

  const abrir = async (f) => { await app.setProject(f.r.project_id); app.state.reelId = f.r.id; await app.go('reels'); document.getElementById('reelDetail')?.scrollIntoView({ behavior: 'smooth' }); };
  const csvCols = [
    { h: 'proyecto', v: (f) => f.p?.tema }, { h: 'url', v: (f) => f.r.url }, { h: 'cuenta', v: (f) => f.c?.handle }, { h: 'publicado', v: (f) => f.r.posted_at },
    { h: 'vistas', v: (f) => f.r.views }, { h: 'likes', v: (f) => f.r.likes }, { h: 'comentarios', v: (f) => f.r.comments }, { h: 'seguidores', v: (f) => f.c?.followers },
    { h: 'vistas_por_seguidor', v: (f) => f.ratio }, { h: 'duracion_s', v: (f) => f.r.duration_s }, { h: 'caption', v: (f) => f.r.caption },
    { h: 'formato', v: (f) => f.t?.visual?.formato }, { h: 'que_ensena', v: (f) => f.t?.visual?.que_ensena }, { h: 'gancho_visual', v: (f) => f.t?.visual?.gancho_visual },
    { h: 'cortes_por_10s', v: (f) => f.t?.visual?.cortes_por_10s }, { h: 'herramientas', v: (f) => (f.t?.visual?.herramientas || []).map((x) => x.nombre).join(', ') },
    { h: 'transcripcion', v: (f) => f.t?.texto }, { h: 'video_guardado', v: (f) => (f.video ? 'sí' : 'no') }, { h: 'versiones', v: (f) => f.versiones }, { h: 'capturado', v: (f) => f.r.captured_at },
  ];
  return [h('section', { class: 'card' },
    h('h2', {}, 'Biblioteca'),
    h('p', { class: 'hint' }, `Todo tu material de todos los proyectos: ${fmt.n(reels.length)} reels guardados, ${fmt.n(trans.length)} analizados, ${fmt.n(conVideo.size)} con video. Busca por tema, herramienta o frase para reutilizar ideas.`),
    h('div', { class: 'row' }, h('div', { class: 'field', style: 'flex:2 1 260px' }, buscar), h('div', { class: 'field', style: 'flex:1 1 200px' }, filtro), h('div', { class: 'field', style: 'flex:1 1 170px' }, orden)),
    h('div', { class: 'row' }, btn('Descargar esta lista (CSV)', () => download('biblioteca-reels.csv', toCSV(csvCols, vis), 'text/csv'), 'alt')),
    vis.length ? table([
      { h: 'Reel', wrap: true, v: (f) => h('span', {}, link(f.r.url, `@${f.c?.handle || '—'}`), ' · ', fmt.fecha(f.r.posted_at), h('br'), h('span', { class: 'muted' }, (f.t?.visual?.que_ensena || f.r.caption || 'sin caption').slice(0, 90))) },
      { h: 'Proyecto', wrap: true, v: (f) => f.p?.tema || '—' },
      { h: 'Vistas', n: true, v: (f) => fmt.n(f.r.views) },
      { h: 'Por seguidor', n: true, v: (f) => (f.ratio == null ? '—' : `${fmt.d(f.ratio, 1)}×`) },
      { h: 'Qué hay', v: (f) => h('span', { style: 'display:flex;flex-wrap:wrap;gap:.25rem' },
        f.t?.visual ? h('span', { class: 'pill ok' }, 'toma a toma') : f.t ? h('span', { class: 'pill warn' }, 'audio') : h('span', { class: 'pill' }, 'cifras'),
        f.video ? h('span', { class: 'pill ok' }, 'video') : null, f.versiones ? h('span', { class: 'pill ok' }, `${f.versiones} versión(es)`) : null) },
      { h: '', v: (f) => btn('Abrir', () => abrir(f), 'small alt') },
    ], vis.slice(0, 300)) : empty(reels.length ? 'Ningún reel coincide con la búsqueda.' : 'Aún no hay reels. Empieza en la pestaña Reels.'),
    vis.length > 300 ? h('p', { class: 'hint' }, `Se muestran 300 de ${vis.length}. Afina la búsqueda o descarga el CSV para verlos todos.`) : null),
    seccionGuiones(app, outputs, proj, reels)];
}

const TIPO = { espejo: 'Mi versión de un reel', guion: 'Guion desde un dolor', servicio: 'Oferta · servicio', infoproducto: 'Oferta · infoproducto' };

/** Todos los guiones, versiones y ofertas generados, de todos los proyectos. */
function seccionGuiones(app, outputs, proj, reels) {
  const st = app.state.lib;
  const lista = [...outputs].sort((a, b) => (a.creado < b.creado ? 1 : -1));
  const abierto = lista.find((o) => o.id === st.salida);
  const reelDe = new Map(reels.map((r) => [r.id, r]));
  const textoPlano = (o) => {
    const c = o.contenido_json;
    if (o.tipo === 'espejo') return [`${TIPO.espejo} · ${NETWORKS[o.red]?.nombre} · ${c.reel_url}`, c.que_ensena, ...c.filas.map((f) => `${f.toma} (${f.t_inicio_s}–${f.t_fin_s} s) | Grabas: ${f.que_grabas} | Edición: ${f.edicion} | Dices: ${f.texto_hablado} | Pantalla: ${f.texto_pantalla}`), `Caption: ${c.caption}`].filter(Boolean).join('\n');
    if (o.tipo === 'guion') return [`${TIPO.guion} · ${NETWORKS[o.red]?.nombre} · ${c.cluster}`, ...c.filas.map((f) => `${f.t_inicio_s}–${f.t_fin_s} s | ${f.texto_hablado} | Pantalla: ${f.texto_pantalla || ''} | Visual: ${f.indicacion_visual || ''}`), `Caption: ${c.caption}`].join('\n');
    return [`${TIPO[o.tipo]} · ${c.cluster}`, c.frase_oferta, `Entregables: ${(c.entregables || []).join(', ')}`, `Precio de prueba (hipótesis): ${c.precio_prueba_hipotesis || ''}`, ...c.citas.map((x) => `«${x.cita}» ${x.url}`)].join('\n');
  };
  return h('section', { class: 'card' },
    h('h2', {}, 'Guiones, versiones y ofertas'),
    h('p', { class: 'hint' }, `${fmt.n(lista.length)} guardados en total. Se conservan aunque vuelvas a generar: cada uno queda con su fecha y el modelo que lo escribió.`),
    lista.length ? h('div', { class: 'row' }, btn('Descargar todos (.txt)', () => download('mis-guiones-y-ofertas.txt', lista.map((o) => `==== ${proj.get(o.project_id)?.tema || ''} · ${fmt.fechaHora(o.creado)}\n${textoPlano(o)}`).join('\n\n'), 'text/plain'), 'alt')) : null,
    lista.length ? table([
      { h: 'Fecha', v: (o) => fmt.fechaHora(o.creado) },
      { h: 'Tipo', v: (o) => `${TIPO[o.tipo] || o.tipo}${o.red ? ` · ${NETWORKS[o.red]?.nombre}` : ''}` },
      { h: 'Proyecto', wrap: true, v: (o) => proj.get(o.project_id)?.tema || '—' },
      { h: 'Sobre', wrap: true, v: (o) => (o.tipo === 'espejo' ? (reelDe.get(o.reel_id)?.caption || o.contenido_json.reel_url || '').slice(0, 70) : o.contenido_json.cluster || '—') },
      { h: '', v: (o) => btn(st.salida === o.id ? 'Cerrar' : 'Ver', () => { st.salida = st.salida === o.id ? null : o.id; app.render(); }, 'small alt') },
    ], lista) : empty('Aún no has generado guiones ni ofertas.'),
    abierto ? renderOutput(abierto) : null);
}
