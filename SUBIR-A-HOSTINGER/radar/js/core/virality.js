// Ranking de viralidad reproducible (sección 3 del plan). Funciones puras: mismos datos → mismo resultado.

const DAY_MS = 86400000;

export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Engagement por vista con los campos disponibles. */
export function engagement(reel) {
  const campos = ['likes', 'comments', 'shares', 'saves'];
  const presentes = campos.filter((c) => isNum(reel[c]));
  if (!isNum(reel.views) || reel.views === 0 || presentes.length === 0) {
    return { ev: null, ev_parcial: true, ev_campos: presentes };
  }
  const suma = presentes.reduce((a, c) => a + reel[c], 0);
  return { ev: suma / reel.views, ev_parcial: presentes.length < campos.length, ev_campos: presentes };
}

/** Velocidad = vistas ÷ días, usando la última captura hecha entre el día 1 y el día 7 del reel. */
export function velocity(reel, snapshots) {
  const posted = Date.parse(reel.posted_at);
  if (!Number.isFinite(posted)) return null;
  let best = null;
  for (const s of snapshots || []) {
    const age = (Date.parse(s.captured_at) - posted) / DAY_MS;
    if (age >= 1 && age <= 7 && isNum(s.views)) {
      if (!best || Date.parse(s.captured_at) > Date.parse(best.captured_at)) best = { ...s, age };
    }
  }
  return best ? best.views / best.age : null;
}

export function label(os, ar, z, th) {
  const arOk = ar != null && ar >= th.viralAR;
  if (os >= th.megaOS && arOk) return 'Mega-viral';
  if ((os >= th.viralOS && arOk) || z >= th.viralZ) return 'Viral';
  if (os >= th.aboveOS) return 'Sobre la media';
  return 'Normal';
}

/**
 * Rankea los reels de un creador.
 * @param reels reels normalizados del creador
 * @param followers seguidores en la fecha de captura (o null)
 * @param snapshotsByReel { [reel_id]: snapshot[] }
 * @param th umbrales
 * @param nowMs instante de referencia (se pasa para que el cálculo sea reproducible)
 */
export function rankCreator(reels, followers, snapshotsByReel, th, nowMs) {
  const excluidos = [];
  const elegibles = [];
  for (const r of reels) {
    const posted = Date.parse(r.posted_at);
    if (!Number.isFinite(posted)) { excluidos.push({ id: r.id, motivo: 'sin fecha de publicación' }); continue; }
    if (!isNum(r.views) || r.views === 0) { excluidos.push({ id: r.id, motivo: 'sin dato de vistas' }); continue; }
    const edad = (nowMs - posted) / DAY_MS;
    if (edad < th.minAgeDays) { excluidos.push({ id: r.id, motivo: `menos de ${th.minAgeDays} días (${edad.toFixed(1)})` }); continue; }
    elegibles.push({ r, posted, edad });
  }
  elegibles.sort((a, b) => b.posted - a.posted || (a.r.id < b.r.id ? -1 : 1));
  const ventana = elegibles.slice(0, th.medianWindow);
  for (const e of elegibles.slice(th.medianWindow)) excluidos.push({ id: e.r.id, motivo: `fuera de los últimos ${th.medianWindow} reels` });

  if (ventana.length < th.minReels) {
    return {
      estado: 'muestra_insuficiente',
      motivo: `Muestra insuficiente: ${ventana.length} reels elegibles; se exigen ${th.minReels}.`,
      n_elegibles: ventana.length, mediana: null, rows: [], excluidos,
    };
  }

  const vistas = ventana.map((e) => e.r.views);
  const med = median(vistas);
  const lns = vistas.map((v) => Math.log(v));
  const media = lns.reduce((a, b) => a + b, 0) / lns.length;
  const sd = Math.sqrt(lns.reduce((a, b) => a + (b - media) ** 2, 0) / lns.length); // desviación poblacional

  const evs = ventana.map((e) => engagement(e.r));
  const evValidos = evs.map((x) => x.ev).filter((v) => v != null);
  const percentil = (v) => {
    if (v == null || !evValidos.length) return null;
    let menores = 0, iguales = 0;
    for (const x of evValidos) { if (x < v) menores++; else if (x === v) iguales++; }
    return (menores + 0.5 * iguales) / evValidos.length;
  };

  const fol = isNum(followers) && followers > 0 ? followers : null;
  const rows = ventana.map((e, i) => {
    const r = e.r;
    const os = r.views / med;
    const ar = fol ? r.views / fol : null;
    const z = sd > 0 ? (lns[i] - media) / sd : 0;
    const { ev, ev_parcial, ev_campos } = evs[i];
    const pev = percentil(ev);
    const score = th.wZ * z + th.wOS * Math.log(os) + th.wEV * (pev ?? 0);
    return {
      reel_id: r.id, creator_id: r.creator_id, views: r.views, edad_dias: e.edad,
      os, ar, ev, ev_parcial, ev_campos, pev, z, score,
      score_parcial: pev == null,
      vel: velocity(r, snapshotsByReel?.[r.id]),
      etiqueta: label(os, ar, z, th),
    };
  });
  return { estado: 'ok', n_elegibles: ventana.length, mediana: med, media_ln: media, sd_ln: sd, followers: fol, rows, excluidos };
}

/** Orden final: Score desc, desempate por VEL desc (nulos al final) y luego por id para ser determinista. */
export function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const va = a.vel ?? -Infinity, vb = b.vel ?? -Infinity;
    if (vb !== va) return vb - va;
    return a.reel_id < b.reel_id ? -1 : a.reel_id > b.reel_id ? 1 : 0;
  });
}

/** Ranking de todo el proyecto. */
export function rankProject(creators, reels, snapshots, th, nowMs) {
  const snapsByReel = {};
  for (const s of snapshots || []) (snapsByReel[s.reel_id] ||= []).push(s);
  const porCreador = {};
  let rows = [];
  for (const c of creators) {
    const propios = reels.filter((r) => r.creator_id === c.id);
    const res = rankCreator(propios, c.followers, snapsByReel, th, nowMs);
    porCreador[c.id] = res;
    rows = rows.concat(res.rows);
  }
  return { rows: sortRows(rows), porCreador };
}
