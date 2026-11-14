// M3: ofertas y guiones por red, a partir de dolores validados y patrones de reels analizados.

import { h, btn, note, fmt, table, link, empty, fnChip } from './dom.js';
import { db } from '../services/store.js';
import * as PL from '../pipeline.js';
import { NETWORKS } from '../core/config.js';

const TIPOS = { servicio: 'Servicio', infoproducto: 'Infoproducto', guion: 'Guion' };

export function renderOutput(o, onDelete) {
  const c = o.contenido_json;
  const cab = h('p', { class: 'hint' }, `Dolor: "${c.cluster}" · generado por ${o.generado_por} el ${fmt.fechaHora(o.creado)} · fórmula ${o.formula_version}`);
  const citas = h('div', {}, h('h3', { class: 'sub3' }, 'Evidencia (citas reales)'), ...c.citas.map((x) => h('div', { class: 'cita' }, `«${x.cita}»`, h('small', {}, /^https?:/.test(x.url) ? link(x.url, 'ver origen') : x.url))));
  const borrar = onDelete ? h('div', { class: 'row noprint' }, btn('Eliminar', onDelete, 'small danger')) : null;
  if (o.tipo === 'guion') {
    const v = c.validacion;
    const red = NETWORKS[o.red];
    return h('section', { class: 'card' },
      h('h2', {}, `Guion para ${red.nombre}`), cab,
      note(v.ok ? 'ok' : 'bad', v.ok ? `Cumple los límites de ${red.nombre}: ${v.duracion_s} s, caption de ${v.caption_chars} caracteres, ${v.hashtags} hashtag(s), un solo CTA y patrón de origen en cada fila.` : 'El guion no pasa la validación. Revisa los puntos y vuelve a generarlo:',
        v.problemas.length ? h('ul', {}, v.problemas.map((x) => h('li', {}, `${x.nivel === 'error' ? 'Error' : 'Aviso'}: ${x.msg}`))) : null),
      table([
        { h: 'Tiempo', v: (f) => `${f.t_inicio_s}–${f.t_fin_s} s` },
        { h: 'Texto hablado', wrap: true, v: (f) => f.texto_hablado },
        { h: 'Texto en pantalla', wrap: true, v: (f) => f.texto_pantalla || '—' },
        { h: 'Indicación visual', wrap: true, v: (f) => f.indicacion_visual || '—' },
        { h: 'Función', v: (f) => fnChip(String(f.funcion).toUpperCase()) },
        { h: 'Patrón de origen', wrap: true, v: (f) => (f.patron ? h('span', {}, f.patron.patron, ' ', f.patron.reel_url ? link(f.patron.reel_url, `(@${f.patron.creador})`) : '') : h('span', { class: 'pill bad' }, 'sin patrón de origen')) },
        { h: 'Dolor que ataca', v: () => c.cluster },
      ], c.filas),
      h('h3', { class: 'sub3' }, 'Caption'), h('p', { style: 'white-space:pre-wrap' }, c.caption || '—'),
      citas, borrar);
  }
  return h('section', { class: 'card' },
    h('h2', {}, `Oferta · ${TIPOS[o.tipo]}`), cab,
    h('p', { style: 'font-family:var(--serif);font-size:1.15rem;margin:.6rem 0' }, c.frase_oferta || '—'),
    c.avisos?.length ? note('warn', c.avisos.join(' ')) : null,
    table([{ h: 'Elemento', v: (r) => r[0] }, { h: 'Contenido', wrap: true, v: (r) => r[1] }, { h: 'Origen', v: (r) => r[2] }], [
      ['Audiencia', c.audiencia || '—', 'redacción de la IA'],
      ['Dolor literal', `«${c.dolor_literal}»`, 'cita real verificada'],
      ['Resultado medible', c.resultado_medible || '—', 'hipótesis de la IA'],
      ['Tiempo', c.tiempo || '—', 'hipótesis de la IA'],
      ['Mecanismo', c.mecanismo || '—', 'hipótesis de la IA'],
      ['Objeción principal', c.objecion_principal || '—', 'hipótesis de la IA'],
      ['Entregables', (c.entregables || []).join(' · ') || '—', 'hipótesis de la IA'],
      ['Precio de prueba', c.precio_prueba_hipotesis || '—', 'hipótesis a validar'],
      ['Métricas del dolor', `${c.metricas.autores} autores · intensidad ${fmt.d(c.metricas.intensidad)} · señal de pago ${fmt.pct(c.metricas.pago)} · Pain Score ${fmt.d(c.metricas.pain_score)}`, 'calculado por la app'],
    ]),
    citas, borrar);
}

export async function viewGenerator(app) {
  const p = app.project;
  const out = [];
  const B = await PL.painBoard(p);
  const patrones = await PL.patronesDisponibles(p);
  const validos = B.clusters.filter((c) => c.valida);
  const paraGuion = B.clusters.filter((c) => c.valida || c.formato === 'guion');
  const st = (app.state.gen ||= { red: p.red_objetivo || 'instagram', cluster: null });

  // --- Ofertas ---
  const of = h('section', { class: 'card' }, h('h2', {}, 'Ofertas'),
    h('p', { class: 'hint' }, 'El formato lo decide una regla, no la IA: servicio si la mayoría quiere delegar; infoproducto si la mayoría quiere aprender. Resultado, tiempo y precio son hipótesis que debes validar.'));
  if (!validos.length) of.append(note('warn', 'Dato insuficiente: ningún dolor pasa todos los umbrales todavía, así que no se genera ninguna oferta. Completa la pestaña Dolores.'));
  else of.append(table([
    { h: 'Dolor validado', wrap: true, v: (c) => c.nombre },
    { h: 'Pain Score', n: true, v: (c) => fmt.d(c.pain_score) },
    { h: 'Formato', v: (c) => TIPOS[c.formato] },
    { h: '', v: (c) => btn('Generar oferta', () => app.run('Generar oferta', (log) => PL.generateOffer(p, c, B.menciones, log)), 'small') },
  ], validos));
  out.push(of);

  // --- Guiones ---
  const gu = h('section', { class: 'card' }, h('h2', {}, 'Guiones por red'),
    h('p', { class: 'hint' }, 'Cada fila del guion usa la estructura de un patrón extraído de un reel viral analizado, rellenada con el dolor de tu audiencia. No se copian frases de otros creadores: la app lo comprueba.'));
  const faltas = [];
  if (!paraGuion.length) faltas.push('no hay ningún dolor con intensidad, frecuencia y recencia suficientes (pestaña Dolores)');
  if (!patrones.length) faltas.push('no hay patrones: transcribe y analiza reels (pestaña Reels)');
  if (faltas.length) gu.append(note('warn', `Dato insuficiente: ${faltas.join('; ')}.`));
  else {
    const red = h('select', {}, Object.entries(NETWORKS).map(([k, v]) => h('option', { value: k, selected: st.red === k }, v.nombre)));
    red.addEventListener('change', () => { st.red = red.value; app.render(); });
    const cl = h('select', {}, paraGuion.map((c) => h('option', { value: c.id, selected: st.cluster === c.id }, `${c.nombre} (${c.valida ? 'válido' : 'guion de audiencia'})`)));
    cl.addEventListener('change', () => { st.cluster = cl.value; });
    const spec = NETWORKS[st.red];
    gu.append(
      h('div', { class: 'row' }, h('label', { class: 'field', style: 'flex:0 1 240px' }, h('span', {}, 'Red'), red), h('label', { class: 'field' }, h('span', {}, 'Dolor'), cl),
        btn('Generar guion', () => { const c = paraGuion.find((x) => x.id === (st.cluster || cl.value)); app.run('Generar guion', (log) => PL.generateScript(p, st.red, c, B.menciones, log)); })),
      h('details', {}, h('summary', {}, `Especificaciones aplicadas a ${spec.nombre}`),
        h('ul', { class: 'hint' }, spec.guia.map((g) => h('li', {}, g)), h('li', {}, spec.notaDuracion)),
        h('p', { class: 'hint' }, 'Los topes de caracteres, hashtags y duración se comprueban en código. Ritmo y tono son guías de partida, no especificaciones oficiales.')),
      h('details', {}, h('summary', {}, `${patrones.length} patrones disponibles`),
        table([{ h: 'Id', v: (x) => x.id }, { h: 'Función', v: (x) => fnChip(x.funcion) }, { h: 'Patrón', wrap: true, v: (x) => x.patron }, { h: 'Reel de origen', v: (x) => (x.reel_url ? link(x.reel_url, `@${x.creador}`) : '—') }], patrones)));
  }
  out.push(gu);

  // --- Generados ---
  const outputs = (await db.byProject('outputs', p.id)).sort((a, b) => (a.creado < b.creado ? 1 : -1));
  if (!outputs.length) out.push(h('section', { class: 'card' }, h('h2', {}, 'Generados'), empty('Aquí aparecerán tus ofertas y guiones.')));
  for (const o of outputs) out.push(renderOutput(o, async () => { if (confirm('¿Eliminar este resultado?')) { await db.del('outputs', o.id); await app.render(); } }));
  return out;
}
