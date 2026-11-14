// Tests del núcleo de cálculo. Ejecutar: node --test radar-tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THRESHOLDS as TH, formulaVersion, NETWORKS } from '../SUBIR-A-HOSTINGER/radar/js/core/config.js';
import { rankCreator, rankProject, median, label, engagement } from '../SUBIR-A-HOSTINGER/radar/js/core/virality.js';
import { buildAnnotations, verifyPainItems, validateScript, isLiteral, sharesRun, hedges } from '../SUBIR-A-HOSTINGER/radar/js/core/validate.js';
import { parseTrendsCSV, trendVerdict, scoreClusters, topCitas } from '../SUBIR-A-HOSTINGER/radar/js/core/pains.js';
import * as N from '../SUBIR-A-HOSTINGER/radar/js/core/normalize.js';

const NOW = Date.parse('2026-11-14T00:00:00Z');
const DAY = 86400000;
const reel = (i, views, ageDays, extra = {}) => ({ id: `r${String(i).padStart(2, '0')}`, creator_id: 'c1', views, likes: Math.round(views * 0.05), comments: Math.round(views * 0.01), shares: null, saves: null, posted_at: new Date(NOW - ageDays * DAY).toISOString(), ...extra });

test('mediana', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test('excluye reels de menos de 7 días y exige 12 elegibles', () => {
  const reels = Array.from({ length: 12 }, (_, i) => reel(i, 1000 + i, 8 + i)).concat([reel(99, 999999, 2)]);
  const r = rankCreator(reels, 5000, {}, TH, NOW);
  assert.equal(r.estado, 'ok');
  assert.equal(r.rows.length, 12);
  assert.ok(r.excluidos.some((e) => e.id === 'r99' && /menos de 7/.test(e.motivo)));
  const pocos = rankCreator(reels.slice(0, 11), 5000, {}, TH, NOW);
  assert.equal(pocos.estado, 'muestra_insuficiente');
  assert.equal(pocos.rows.length, 0);
});

test('OS, AR, etiquetas y ejemplo del plan (8.000 seguidores, 200.000 vistas)', () => {
  const reels = Array.from({ length: 14 }, (_, i) => reel(i, 10000, 10 + i));
  reels[3] = reel(3, 200000, 13);
  const r = rankCreator(reels, 8000, {}, TH, NOW);
  const top = r.rows.find((x) => x.reel_id === 'r03');
  assert.equal(r.mediana, 10000);
  assert.equal(top.os, 20);
  assert.equal(top.ar, 25);
  assert.equal(top.etiqueta, 'Mega-viral');
  assert.equal(r.rows.find((x) => x.reel_id === 'r00').etiqueta, 'Normal');
  // Cuenta grande con vistas por debajo de sus seguidores: no es viral por OS/AR.
  assert.equal(label(1, 0.25, 0.2, TH), 'Normal');
  assert.equal(label(4, 0.5, 1, TH), 'Sobre la media');
  assert.equal(label(4, 0.5, 2.1, TH), 'Viral');
  assert.equal(label(3, 1, 0, TH), 'Viral');
  assert.equal(label(12, null, 0, TH), 'Sobre la media');
});

test('Score = 0,5·z + 0,3·ln(OS) + 0,2·percentil(EV)', () => {
  const reels = Array.from({ length: 12 }, (_, i) => reel(i, 1000 * (i + 1), 10 + i));
  const r = rankCreator(reels, 3000, {}, TH, NOW);
  for (const x of r.rows) {
    assert.ok(Math.abs(x.score - (0.5 * x.z + 0.3 * Math.log(x.os) + 0.2 * x.pev)) < 1e-12);
    assert.equal(x.ev_parcial, true);
  }
  const zs = r.rows.map((x) => x.z);
  assert.ok(Math.abs(zs.reduce((a, b) => a + b, 0)) < 1e-9, 'la media de z es 0');
});

test('EV usa solo los campos presentes y nunca rellena', () => {
  assert.deepEqual(engagement({ views: 100, likes: 10, comments: 5, shares: 3, saves: 2 }), { ev: 0.2, ev_parcial: false, ev_campos: ['likes', 'comments', 'shares', 'saves'] });
  assert.equal(engagement({ views: 100, likes: null, comments: null }).ev, null);
  assert.equal(engagement({ views: 100, likes: null, comments: 5 }).ev, 0.05);
});

test('ranking reproducible: mismo resultado en dos ejecuciones y con los datos desordenados', () => {
  const creators = [{ id: 'c1', followers: 9000 }, { id: 'c2', followers: 500 }];
  const reels = [];
  for (let i = 0; i < 15; i++) { reels.push(reel(i, 900 + ((i * 7919) % 5000), 9 + i)); reels.push({ ...reel(i + 50, 300 + ((i * 104729) % 9000), 9 + i), creator_id: 'c2' }); }
  const a = rankProject(creators, reels, [], TH, NOW).rows.map((x) => x.reel_id);
  const b = rankProject(creators, [...reels].reverse(), [], TH, NOW).rows.map((x) => x.reel_id);
  assert.deepEqual(a, b);
  assert.equal(a.length, 30);
});

test('velocidad solo con capturas entre el día 1 y el 7', () => {
  const reels = Array.from({ length: 12 }, (_, i) => reel(i, 1000, 10 + i));
  const snaps = { r00: [{ captured_at: new Date(NOW - 6 * DAY).toISOString(), views: 800 }, { captured_at: new Date(NOW).toISOString(), views: 1000 }] };
  const r = rankCreator(reels, 100, snaps, TH, NOW);
  assert.equal(r.rows.find((x) => x.reel_id === 'r00').vel, 200); // captura a los 4 días: 800 ÷ 4
  assert.equal(r.rows.find((x) => x.reel_id === 'r01').vel, null);
});

test('versión de fórmula cambia al calibrar umbrales', () => {
  assert.equal(formulaVersion({ ...TH }), 'v1');
  const v = formulaVersion({ ...TH, viralOS: 4 });
  assert.match(v, /^v1-[0-9a-f]{8}$/);
  assert.equal(v, formulaVersion({ ...TH, viralOS: 4 }));
});

const words = 'Si eres coach y no vendes, mira esto. El error es publicar sin gancho. Sígueme para más.'.split(' ').map((w, i) => ({ word: w, start: i * 0.4, end: i * 0.4 + 0.35 }));

test('anotaciones: texto y tiempos salen de la transcripción; lo inventado se descarta', () => {
  const { anotaciones, rechazados } = buildAnnotations('r1', words, [
    { w_inicio: 0, w_fin: 2, seccion: 'gancho', funcion: 'IDE', palabras_gatillo: ['Si eres coach', 'emprendedor'], mecanismo: 'm', por_que_engancha: 'p', patron_reutilizable: 'Si eres [audiencia]', confianza: 0.9 },
    { w_inicio: 3, w_fin: 7, seccion: 'gancho', funcion: 'INVENTADA', palabras_gatillo: [], patron_reutilizable: 'x', confianza: 2 },
    { w_inicio: 8, w_fin: 13, seccion: 'desarrollo', funcion: 'NEG', palabras_gatillo: ['error'], patron_reutilizable: 'El error es publicar sin gancho', por_que_engancha: 'tal vez funcione', confianza: 0.7 },
    { w_inicio: 12, w_fin: 14, funcion: 'CTA' },
    { w_inicio: 14, w_fin: 99, funcion: 'CTA' },
    { w_inicio: 14, w_fin: 16, seccion: 'cta', funcion: 'cta', palabras_gatillo: ['Sígueme'], patron_reutilizable: 'Sígueme para [beneficio]', confianza: 0.8 },
  ]);
  assert.equal(anotaciones.length, 4);
  assert.equal(rechazados.length, 2);
  const [a, b, c, d] = anotaciones;
  assert.equal(a.texto_exacto, 'Si eres coach');
  assert.equal(a.start_ms, 0); assert.equal(a.end_ms, 1150);
  assert.deepEqual(a.palabras_gatillo, ['Si eres coach']);
  assert.equal(a.seccion, 'Gancho 0–1 s');
  assert.equal(b.funcion, 'sin_gatillo'); assert.equal(b.patron, ''); assert.equal(b.confianza, 1);
  assert.equal(b.seccion, 'Gancho 1–3 s');
  assert.equal(c.patron, '', 'un patrón que copia la frase original se descarta');
  assert.ok(c.avisos.some((x) => /dubitativo/.test(x)));
  assert.equal(d.funcion, 'CTA'); assert.equal(d.seccion, 'CTA');
});

const comentarios = [
  { id: 'p:ytc:1', project_id: 'p', fuente: 'youtube', url: 'https://youtu.be/x', autor_hash: 'a1', fecha: '2026-08-01T00:00:00Z', texto: 'Llevo meses publicando y no consigo ni un cliente. Pagué 300 euros por un curso y nada.' },
  { id: 'p:ytc:2', project_id: 'p', fuente: 'youtube', url: 'https://youtu.be/x', autor_hash: 'a2', fecha: null, texto: 'Gran video, gracias!' },
];

test('dolores: se descartan citas no literales y señales de pago sin evidencia', () => {
  const { menciones, rechazados } = verifyPainItems(comentarios, [
    { i: 0, cita: 'llevo meses publicando y no consigo ni un cliente', dolor_normalizado: 'publica sin conseguir clientes', emocion: 'Frustración', intensidad: 4, senal_pago: true, evidencia_pago: 'Pagué 300 euros por un curso', solucion_intentada: 'contraté una agencia', tipo_necesidad: 'aprender' },
    { i: 1, cita: 'no sé cómo empezar', dolor_normalizado: 'no sabe empezar', intensidad: 3, senal_pago: false },
    { i: 7, cita: 'x', dolor_normalizado: 'y', intensidad: 3 },
    { i: 1, cita: 'Gran video', dolor_normalizado: 'elogio', intensidad: 9 },
  ]);
  assert.equal(menciones.length, 1);
  assert.equal(rechazados.length, 3);
  const m = menciones[0];
  assert.equal(m.url, 'https://youtu.be/x'); assert.equal(m.autor_hash, 'a1'); assert.equal(m.fecha, '2026-08-01T00:00:00Z');
  assert.equal(m.senal_pago, true);
  assert.equal(m.solucion_intentada, '', 'la solución inventada no se guarda');
  const sinEv = verifyPainItems(comentarios, [{ i: 0, cita: 'no consigo ni un cliente', dolor_normalizado: 'sin clientes', intensidad: 4, senal_pago: true, evidencia_pago: 'pagaría lo que fuera' }]);
  assert.equal(sinEv.menciones[0].senal_pago, false);
});

test('literalidad y copia', () => {
  assert.ok(isLiteral('  NO consigo   ni un cliente', comentarios[0].texto));
  assert.ok(!isLiteral('no consigo clientes', comentarios[0].texto));
  assert.ok(!isLiteral('', 'abc'));
  assert.equal(sharesRun('hoy te digo: el error es publicar sin gancho, amiga', 'El error es publicar sin gancho.', 5), 'el error es publicar sin');
  assert.equal(sharesRun('el error es otro', 'El error es publicar sin gancho.', 5), null);
  assert.deepEqual(hedges('Esto quizás funcione'), ['quizás']);
  assert.deepEqual(hedges('Esto funciona'), []);
});

function mencion(i, cl, o = {}) { return { id: `m${i}`, cluster_id: cl, autor_hash: `a${i}`, fuente: i % 2 ? 'youtube' : 'instagram', intensidad: 4, senal_pago: i % 5 === 0, fecha: '2026-06-01T00:00:00Z', tipo_necesidad: 'aprender', cita_corta: `cita ${i}`, ...o }; }

test('clusters: umbrales, Pain Score y formato', () => {
  const ms = [];
  for (let i = 0; i < 20; i++) ms.push(mencion(i, 'A'));
  for (let i = 20; i < 30; i++) ms.push(mencion(i, 'B'));
  for (let i = 30; i < 46; i++) ms.push(mencion(i, 'C', { senal_pago: false, intensidad: 5 }));
  for (let i = 46; i < 62; i++) ms.push(mencion(i, 'D', { fuente: 'youtube' }));
  for (let i = 62; i < 80; i++) ms.push(mencion(i, 'E', { fecha: '2023-01-01T00:00:00Z' }));
  const cls = ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id, nombre: id }));
  const sc = scoreClusters(ms, cls, TH, NOW, { estado: 'dato_insuficiente' });
  const g = Object.fromEntries(sc.map((c) => [c.id, c]));
  assert.equal(g.A.valida, true); assert.equal(g.A.formato, 'infoproducto'); assert.equal(g.A.criterios.mercado, null);
  assert.equal(g.A.autores, 20); assert.equal(g.A.pago, 0.2); assert.equal(g.A.recencia, 1);
  assert.ok(Math.abs(g.A.pain_score - (0.3 * 1 + 0.25 * 0.8 + 0.3 * 0.2 + 0.15 * 1)) < 1e-12);
  assert.equal(g.B.valida, false, 'menos de 15 autores');
  assert.equal(g.C.valida, false); assert.equal(g.C.formato, 'guion', 'intensidad alta sin señal de pago → guion');
  assert.equal(g.D.valida, false, 'una sola fuente');
  assert.equal(g.E.valida, false, 'menciones antiguas');
  const baja = scoreClusters(ms, cls, TH, NOW, { estado: 'decreciente' });
  assert.equal(baja.find((c) => c.id === 'A').valida, false, 'tendencia decreciente invalida');
  const serv = scoreClusters(ms.map((m) => ({ ...m, tipo_necesidad: 'delegar' })), cls, TH, NOW, { estado: 'estable' });
  assert.equal(serv.find((c) => c.id === 'A').formato, 'servicio');
  assert.equal(topCitas(ms, 'A', 5).length, 5);
});

test('CSV de Google Trends', () => {
  const csv = 'Categoría: Todas las categorías\n\nSemana,marketing para coaches: (España)\n' + Array.from({ length: 12 }, (_, i) => `2026-0${1 + (i % 9)}-0${1 + (i % 9)},${i < 3 ? '<1' : 40 + i}`).join('\n');
  const p = parseTrendsCSV(csv);
  assert.equal(p.length, 12); assert.equal(p[0].valor, 0.5);
  assert.equal(trendVerdict(p, 0.9).estado, 'creciente');
  const plano = Array.from({ length: 12 }, (_, i) => ({ fecha: `2026-01-${i + 10}`, valor: 50 }));
  assert.equal(trendVerdict(plano, 0.9).estado, 'estable');
  assert.equal(trendVerdict(plano.map((x, i) => ({ ...x, valor: 100 - i * 8 })), 0.9).estado, 'decreciente');
  assert.equal(trendVerdict([], 0.9).estado, 'dato_insuficiente');
});

test('guion: límites de red, un solo CTA, patrón de origen y no copiar', () => {
  const fila = (o) => ({ t_inicio_s: 0, t_fin_s: 3, texto_hablado: 'hola', funcion: 'CUR', patron_id: 'P1', ...o });
  const ok = validateScript({ filas: [fila({}), fila({ t_inicio_s: 3, t_fin_s: 20, funcion: 'CTA' })], caption: 'Texto #uno #dos' }, NETWORKS.instagram, ['P1'], []);
  assert.equal(ok.ok, true); assert.equal(ok.duracion_s, 20);
  const mal = validateScript({
    filas: [fila({ patron_id: 'P9' }), fila({ funcion: 'CTA' }), fila({ funcion: 'CTA', texto_hablado: 'el error es publicar sin gancho hoy', t_inicio_s: 3, t_fin_s: 200 })],
    caption: '#a #b #c #d #e #f ' + 'x'.repeat(2300),
  }, NETWORKS.instagram, ['P1'], [{ texto: 'El error es publicar sin gancho hoy.' }]);
  assert.equal(mal.ok, false);
  const msgs = mal.problemas.map((p) => p.msg).join('\n');
  for (const re of [/2 CTA/, /patrón de origen/, /6 hashtags/, /Caption de/, /reproduce una frase/, /máximo de la red/]) assert.match(msgs, re);
});

test('normalización de Apify y YouTube: lo que no viene queda en null', async () => {
  const r = N.normIgReel({ shortCode: 'ABC', ownerUsername: 'Vane.IA_', timestamp: '2026-10-01T10:00:00.000Z', videoPlayCount: 48000, videoViewCount: 50000, likesCount: -1, commentsCount: 42, videoDuration: 30.5, videoUrl: 'https://cdn/x.mp4', caption: null }, 't');
  assert.equal(r.id, 'ig:ABC'); assert.equal(r.views, 48000); assert.equal(r.views_campo, 'videoPlayCount');
  assert.equal(r.likes, null); assert.equal(r.shares, null); assert.equal(r.saves, null); assert.equal(r.handle, 'vane.ia_');
  assert.equal(N.normIgReel({ error: 'not_found' }, 't'), null);
  assert.equal(N.normIgReel({ shortCode: 'Z' }, 't').views, null);
  const t = N.normTtVideo({ id: '73', authorMeta: { name: 'Ana', fans: 1200 }, playCount: 900, diggCount: 10, shareCount: 2, commentCount: 1, collectCount: 4, createTimeISO: '2026-10-01T00:00:00.000Z', videoMeta: { duration: 21 }, webVideoUrl: 'https://www.tiktok.com/@ana/video/73' }, 't');
  assert.equal(t.followers, 1200); assert.equal(t.saves, 4); assert.equal(t.handle, 'ana');
  assert.equal(N.normTtVideo({ id: '1', isSlideshow: true }, 't'), null);
  const y = N.normYtThread({ snippet: { videoId: 'vid', topLevelComment: { id: 'c1', snippet: { textOriginal: 'No me funciona', authorChannelId: { value: 'UC1' }, publishedAt: '2026-01-01T00:00:00Z' } } } });
  assert.equal(y.url, 'https://www.youtube.com/watch?v=vid&lc=c1');
  assert.equal(N.cleanHandle('https://www.instagram.com/Vane.IA_/?hl=es'), 'vane.ia_');
  assert.equal(N.cleanHandle('@Ana'), 'ana');
  const a = await N.anonymize({ ...y }, 'p1');
  assert.match(a.autor_hash, /^[0-9a-f]{16}$/); assert.ok(!JSON.stringify(a).includes('UC1'));
  assert.equal(N.parseManualPaste('Primera queja larga de verdad\nSegunda queja larga de verdad\n\ncorto', 'https://foro', '2026-01-01').length, 2);
});
