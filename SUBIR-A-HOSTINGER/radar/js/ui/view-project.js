// Proyecto: tema, audiencia, referentes y descubrimiento de referentes (M0).

import { h, field, input, btn, note, fmt, table, link, empty } from './dom.js';
import { db, uid, getSettings } from '../services/store.js';
import { addCreator, removeCreator, sugerirHashtags, discover, costoEstimado } from '../pipeline.js';
import { NETWORKS } from '../core/config.js';

export async function viewProject(app) {
  const out = [];
  const p = app.project;

  // --- Crear / editar ---
  const tema = input({ value: p?.tema || '', placeholder: 'Ej.: automatizar ventas con IA' });
  const nicho = input({ value: p?.nicho_usuario || '', placeholder: 'Ej.: creo bots de WhatsApp con IA para negocios' });
  const aud = input({ value: p?.audiencia || '', placeholder: 'Ej.: dueños de pequeños negocios que venden por WhatsApp' });
  const red = h('select', {}, Object.entries(NETWORKS).map(([k, v]) => h('option', { value: k, selected: (p?.red_objetivo || 'instagram') === k }, v.nombre)));
  const guardar = async (nuevo) => {
    if (!tema.value.trim()) { alert('Escribe el tema del proyecto.'); return; }
    const row = { ...(nuevo ? {} : p), id: nuevo ? uid('p') : p.id, tema: tema.value.trim(), nicho_usuario: nicho.value.trim(), audiencia: aud.value.trim(), red_objetivo: red.value, created_at: nuevo ? new Date().toISOString() : p.created_at };
    await db.put('projects', row);
    await app.setProject(row.id);
  };
  out.push(h('section', { class: 'card' },
    h('h2', {}, p ? 'Proyecto activo' : 'Crea tu primer proyecto'),
    h('p', { class: 'hint' }, 'Con esto la app adapta cada reel que copies a lo que tú vendes y busca sola los dolores de tu audiencia.'),
    h('div', { class: 'grid2' },
      field('Tema', tema, 'De qué hablas en tus reels.'), field('Tu servicio (lo que vendes)', nicho, 'Cada reel copiado se adapta a esto.'),
      field('A quién se lo vendes', aud, 'Se usa para el tono y para buscar sus dolores.'), field('Red donde publicas', red)),
    h('div', { class: 'row' },
      p ? btn('Guardar cambios', () => guardar(false)) : null,
      btn(p ? 'Crear como proyecto nuevo' : 'Crear proyecto', () => guardar(true), p ? 'alt' : ''),
      p ? btn('Eliminar proyecto', async () => {
        if (!confirm(`¿Eliminar "${p.tema}" y todos sus datos? No se puede deshacer.`)) return;
        await db.deleteProject(p.id); await app.setProject(null);
      }, 'danger') : null)));
  if (!p) return out;

  // --- Referentes ---
  const creators = (await db.byProject('creators', p.id)).filter((c) => c.origen !== 'enlace').sort((a, b) => (a.handle < b.handle ? -1 : 1));
  const plat = h('select', { 'aria-label': 'Plataforma' }, h('option', { value: 'instagram' }, 'Instagram'), h('option', { value: 'tiktok' }, 'TikTok'));
  const handle = input({ placeholder: '@usuario o enlace del perfil', 'aria-label': 'Usuario del referente' });
  const err = h('div', {});
  const add = async () => {
    try { await addCreator(p, plat.value, handle.value); await app.render(); }
    catch (e) { err.replaceChildren(note('bad', e.message)); }
  };
  handle.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  const ref = h('section', { class: 'card' },
    h('h2', {}, 'Referentes'),
    h('p', { class: 'hint' }, 'Opcional. Cuentas de tu nicho cuyos reels funcionan: la app encuentra cuáles destacan para que los copies. Si ya tienes los enlaces de los reels, pégalos directamente en la pestaña Reels. Solo se leen datos públicos, sin iniciar sesión.'),
    h('div', { class: 'row' }, h('div', { class: 'field', style: 'flex:0 1 150px' }, plat), h('div', { class: 'field' }, handle), btn('Añadir referente', add)),
    err);
  if (creators.length) {
    ref.append(table([
      { h: 'Cuenta', v: (c) => link(c.url || (c.plataforma === 'instagram' ? `https://www.instagram.com/${c.handle}/` : `https://www.tiktok.com/@${c.handle}`), `@${c.handle}`) },
      { h: 'Red', v: (c) => (c.plataforma === 'instagram' ? 'Instagram' : 'TikTok') },
      { h: 'Seguidores', n: true, v: (c) => (c.captured_at ? fmt.n(c.followers) : 'sin capturar') },
      { h: 'Capturado', v: (c) => (c.captured_at ? fmt.fechaHora(c.captured_at) : '—') },
      { h: 'Origen', v: (c) => c.origen },
      { h: 'Estado', wrap: true, v: (c) => (c.error ? h('span', { class: 'pill bad' }, c.error) : c.privado ? h('span', { class: 'pill bad' }, 'perfil privado') : '') },
      { h: '', v: (c) => btn('Quitar', async () => { if (confirm(`¿Quitar @${c.handle} y sus reels?`)) { await removeCreator(p, c); await app.render(); } }, 'small danger') },
    ], creators),
    h('div', { class: 'row' }, btn('Encontrar sus virales →', () => app.go('reels'))));
  } else ref.append(empty('Aún no hay referentes.'));
  out.push(ref);

  // --- Descubrimiento (M0) ---
  const st = (app.state.disc ||= { plataforma: 'instagram', hashtags: '', porHashtag: 30, candidatos: null });
  const dPlat = h('select', {}, h('option', { value: 'instagram', selected: st.plataforma === 'instagram' }, 'Instagram'), h('option', { value: 'tiktok', selected: st.plataforma === 'tiktok' }, 'TikTok'));
  dPlat.addEventListener('change', () => { st.plataforma = dPlat.value; app.render(); });
  const tags = input({ value: st.hashtags, placeholder: 'hashtags separados por comas, sin #' });
  tags.addEventListener('input', () => { st.hashtags = tags.value; pintarCosto(); });
  const por = input({ type: 'number', min: '10', max: '100', value: st.porHashtag });
  por.addEventListener('input', () => { st.porHashtag = Math.max(1, Number(por.value) || 30); pintarCosto(); });
  const lista = () => [...new Set(st.hashtags.split(/[,\n]/).map((x) => x.trim().replace(/^#/, '').replace(/\s+/g, '').toLowerCase()).filter(Boolean))];
  const costo = h('p', { class: 'hint' });
  const pintarCosto = () => {
    const n = lista().length;
    const actor = st.plataforma === 'instagram' ? 'igHashtag' : 'ttVideos';
    costo.textContent = n ? `Costo máximo estimado en Apify: ${fmt.usd(costoEstimado(actor, n * st.porHashtag))} (${n} hashtag(s) × ${st.porHashtag} resultados, tarifa del plan Free).` : '';
  };
  pintarCosto();
  const disc = h('section', { class: 'card' },
    h('h2', {}, 'Descubrir referentes'),
    h('p', { class: 'hint' }, 'Opcional. Busca reels por hashtag y muestra qué creadores aparecen más, con sus cifras reales. Tú decides a quién añadir; al traer sus métricas se comprueba que tengan al menos 12 reels elegibles.'),
    h('div', { class: 'row' },
      h('div', { class: 'field', style: 'flex:0 1 150px' }, h('span', {}, 'Red'), dPlat),
      field('Hashtags', tags),
      h('div', { class: 'field', style: 'flex:0 1 130px' }, h('span', {}, 'Reels por hashtag'), por)),
    costo,
    h('div', { class: 'row' },
      btn('Sugerir hashtags con IA', () => app.run('Sugerir hashtags', async (log) => { st.hashtags = (await sugerirHashtags(p, st.plataforma, log)).join(', '); }), 'alt'),
      btn('Buscar creadores', () => {
        const hs = lista();
        if (!hs.length) { alert('Escribe al menos un hashtag.'); return; }
        if (!getSettings().keys.apify) { alert('Falta el token de Apify (Configuración).'); return; }
        app.run('Descubrir referentes', async (log) => { st.candidatos = await discover(p, st.plataforma, hs, st.porHashtag, log); });
      })));
  if (st.candidatos) {
    const ya = new Set(creators.map((c) => `${c.plataforma}:${c.handle}`));
    disc.append(st.candidatos.length ? table([
      { h: 'Creador', v: (c) => link(c.ejemplo, `@${c.handle}`) },
      { h: 'Reels encontrados', n: true, v: (c) => fmt.n(c.reels) },
      { h: 'Vistas máx.', n: true, v: (c) => fmt.n(c.vistasMax) },
      { h: 'Vistas sumadas', n: true, v: (c) => fmt.n(c.vistasTotal) },
      { h: 'Seguidores', n: true, v: (c) => (c.followers == null ? 'se obtiene al añadir' : fmt.n(c.followers)) },
      { h: '', v: (c) => (ya.has(`${c.plataforma}:${c.handle}`) ? h('span', { class: 'pill ok' }, 'añadido') : btn('Añadir', async () => { await addCreator(p, c.plataforma, c.handle, 'descubierto'); await app.render(); }, 'small')) },
    ], st.candidatos) : empty('La búsqueda no devolvió creadores. Prueba con otros hashtags.'));
  }
  out.push(disc);
  return out;
}
