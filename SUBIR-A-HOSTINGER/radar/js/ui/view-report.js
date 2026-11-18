// M4: informe imprimible (Imprimir → Guardar como PDF) con la procedencia de cada dato.

import { h, btn, note, fmt, table, link, etiquetaPill, download } from './dom.js';
import { db, getSettings } from '../services/store.js';
import * as PL from '../pipeline.js';
import { renderAnotaciones, renderVisual } from './view-reels.js';
import { criterioPills, citasNodes } from './view-pains.js';
import { renderOutput } from './view-generator.js';
import { NETWORKS } from '../core/config.js';

export async function viewReport(app) {
  const p = app.project;
  const th = getSettings().thresholds;
  const out = [];
  const R = await PL.ranking(p);
  const B = await PL.painBoard(p);
  const [anot, trans, outputs, runs] = await Promise.all([db.byProject('annotations', p.id), db.byProject('transcripts', p.id), db.byProject('outputs', p.id), db.byProject('runs', p.id)]);
  const reelDe = new Map(R.reels.map((r) => [r.id, r]));
  const creDe = new Map(R.creators.map((c) => [c.id, c]));

  out.push(h('section', { class: 'card' },
    h('h2', {}, `Informe · ${p.tema}`),
    h('p', { class: 'hint' }, `Nicho: ${p.nicho_usuario || '—'} · Audiencia: ${p.audiencia || '—'} · Red objetivo: ${NETWORKS[p.red_objetivo]?.nombre || '—'} · Fórmula ${R.formula_version} · Generado el ${fmt.fechaHora(new Date().toISOString())}.`),
    h('div', { class: 'row noprint' },
      btn('Imprimir o guardar como PDF', () => window.print()),
      btn('Descargar datos del proyecto (JSON)', async () => {
        const data = { proyecto: p, formula_version: R.formula_version, umbrales: th, ranking: R.rows, creadores: R.creators, reels: R.reels.map(({ video_url, audio_url, ...r }) => r), transcripciones: trans, anotaciones: anot, dolores: B.clusters, menciones: B.menciones, resultados: outputs, ejecuciones: runs };
        download(`informe-${p.tema.slice(0, 30).replace(/\W+/g, '-')}.json`, JSON.stringify(data, null, 1));
      }, 'alt'))));

  // Reels
  const top = R.rows.slice(0, 10);
  const sec = h('section', { class: 'card' }, h('h2', {}, 'Reels más virales'));
  if (!top.length) sec.append(note('warn', 'Dato insuficiente: no hay ranking. Trae métricas en la pestaña Reels.'));
  else {
    sec.append(h('p', { class: 'hint' }, `Métricas capturadas el ${fmt.fechaHora(R.referencia)} con Apify. Viral = OS ≥ ${th.viralOS} y AR ≥ ${th.viralAR}, o z ≥ ${th.viralZ}. Mega-viral = OS ≥ ${th.megaOS} y AR ≥ ${th.viralAR}.`),
      table([
        { h: '#', n: true, v: (x) => top.indexOf(x) + 1 },
        { h: 'Reel', v: (x) => { const r = reelDe.get(x.reel_id); return link(r.url, `@${creDe.get(r.creator_id)?.handle} · ${fmt.fecha(r.posted_at)}`); } },
        { h: 'Etiqueta', v: (x) => etiquetaPill(x.etiqueta) },
        { h: 'Score', n: true, v: (x) => fmt.d(x.score) },
        { h: 'Vistas', n: true, v: (x) => fmt.n(x.views) },
        { h: 'OS', n: true, v: (x) => `${fmt.d(x.os, 1)}×` },
        { h: 'AR', n: true, v: (x) => (x.ar == null ? 'dato insuficiente' : `${fmt.d(x.ar)}×`) },
        { h: 'z', n: true, v: (x) => fmt.d(x.z) },
      ], top));
    for (const x of top) {
      const an = anot.filter((a) => a.reel_id === x.reel_id);
      const tv = trans.find((t) => t.reel_id === x.reel_id)?.visual;
      if (!an.length && !tv) continue;
      const r = reelDe.get(x.reel_id);
      sec.append(h('h3', {}, `#${top.indexOf(x) + 1} · @${creDe.get(r.creator_id)?.handle} · `, link(r.url, 'ver reel')), tv ? renderVisual(tv) : null, ...renderAnotaciones(an));
    }
    const sin = top.filter((x) => !anot.some((a) => a.reel_id === x.reel_id)).length;
    if (sin) sec.append(note('warn', `${sin} reel(s) del top aún no están analizados.`));
  }
  out.push(sec);

  // Dolores
  const dol = h('section', { class: 'card' }, h('h2', {}, 'Dolores'));
  const mostrar = B.clusters.filter((c) => c.valida || c.formato === 'guion');
  if (!mostrar.length) dol.append(note('warn', `Dato insuficiente: ningún dolor pasa los umbrales (${B.menciones.length} dolores verificados en ${B.clusters.length} grupos).`));
  for (const c of mostrar) dol.append(h('h3', {}, `${c.nombre} · Pain Score ${fmt.d(c.pain_score)}`), criterioPills(c, th), ...citasNodes(B.menciones, c.id));
  out.push(dol);

  // Resultados
  for (const o of outputs.sort((a, b) => (a.creado < b.creado ? 1 : -1))) out.push(renderOutput(o));

  // Procedencia
  out.push(h('section', { class: 'card' }, h('h2', {}, 'Procedencia de los datos'),
    h('p', { class: 'hint' }, 'Cada cifra de este informe proviene de una de estas capturas. Las interpretaciones (mecanismo, por qué engancha, ofertas y guiones) las redacta un modelo de IA sobre texto verificado.'),
    runs.length ? table([
      { h: 'Fecha', v: (r) => fmt.fechaHora(r.fecha) }, { h: 'Captura', v: (r) => r.tipo.replace(/_/g, ' ') }, { h: 'Fuente', v: (r) => r.actor || '—' },
      { h: 'Resultado', wrap: true, v: (r) => r.detalle }, { h: 'Costo', n: true, v: (r) => (r.costoUsd == null ? '—' : fmt.usd(r.costoUsd)) },
    ], runs.sort((a, b) => (a.fecha < b.fecha ? 1 : -1))) : note('warn', 'Aún no hay capturas.')));
  return out;
}
