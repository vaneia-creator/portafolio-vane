// Convierte las respuestas reales de Apify y YouTube al esquema de la app.
// Nombres de campo verificados contra los esquemas de salida publicados por cada actor (2026-11-14).
// Regla: si un dato no viene, queda en null. Nunca se rellena.

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function cleanHandle(input) {
  let h = String(input || '').trim();
  const m = h.match(/(?:instagram\.com|tiktok\.com)\/@?([^/?#\s]+)/i);
  if (m) h = m[1];
  return h.replace(/^@/, '').replace(/\/+$/, '').toLowerCase();
}

export function normIgReel(item, capturedAt) {
  const code = str(item?.shortCode);
  if (!item || item.error || !code) return null;
  const vistas = num(item.videoPlayCount) ?? num(item.igPlayCount) ?? num(item.videoViewCount);
  const campo = num(item.videoPlayCount) != null ? 'videoPlayCount' : num(item.igPlayCount) != null ? 'igPlayCount' : num(item.videoViewCount) != null ? 'videoViewCount' : null;
  return {
    id: `ig:${code}`,
    plataforma: 'instagram',
    shortcode: code,
    handle: (str(item.ownerUsername) || '').toLowerCase() || null,
    url: `https://www.instagram.com/reel/${code}/`,
    posted_at: str(item.timestamp),
    duration_s: num(item.videoDuration),
    caption: str(item.caption) || '',
    views: vistas,
    views_campo: campo,
    likes: num(item.likesCount), // Instagram devuelve -1 cuando el autor oculta los likes → null
    comments: num(item.commentsCount),
    shares: num(item.sharesCount),
    saves: null, // Instagram no publica guardados
    video_url: str(item.videoUrl),
    audio_url: str(item.audioUrl),
    is_pinned: item.isPinned === true,
    captured_at: capturedAt,
    fuente_dato: 'Apify apify/instagram-reel-scraper',
  };
}

export function normIgProfile(item, capturedAt) {
  const user = str(item?.username);
  if (!item || item.error || !user) return null;
  return {
    handle: user.toLowerCase(),
    followers: num(item.followersCount),
    url: `https://www.instagram.com/${user}/`,
    privado: item.private === true,
    captured_at: capturedAt,
  };
}

export function normTtVideo(item, capturedAt) {
  const id = str(item?.id);
  if (!item || item.error || !id || item.isSlideshow === true) return null;
  const autor = item.authorMeta || {};
  const vm = item.videoMeta || {};
  const handle = (str(autor.name) || str(autor.uniqueId) || '').toLowerCase() || null;
  return {
    id: `tt:${id}`,
    plataforma: 'tiktok',
    shortcode: id,
    handle,
    followers: num(autor.fans),
    url: str(item.webVideoUrl) || (handle ? `https://www.tiktok.com/@${handle}/video/${id}` : null),
    posted_at: str(item.createTimeISO) || (num(item.createTime) ? new Date(item.createTime * 1000).toISOString() : null),
    duration_s: num(vm.duration),
    caption: str(item.text) || '',
    views: num(item.playCount),
    views_campo: num(item.playCount) != null ? 'playCount' : null,
    likes: num(item.diggCount),
    comments: num(item.commentCount),
    shares: num(item.shareCount),
    saves: num(item.collectCount),
    video_url: str(vm.downloadAddr) || str(vm.originalDownloadAddr) || (Array.isArray(item.mediaUrls) ? str(item.mediaUrls[0]) : null),
    audio_url: null,
    is_pinned: item.isPinned === true,
    es_anuncio: item.isAd === true || item.isSponsored === true,
    captured_at: capturedAt,
    fuente_dato: 'Apify clockworks/tiktok-scraper',
  };
}

export function normIgComment(item) {
  const texto = str(item?.text);
  if (!item || item.error || !texto || !str(item.id)) return null;
  return { id: `igc:${item.id}`, fuente: 'instagram', url: str(item.postUrl) || str(item.url), autor: str(item.ownerUsername) || `anon-${item.id}`, fecha: str(item.timestamp), texto };
}

export function normTtComment(item) {
  const texto = str(item?.text);
  if (!item || !texto || !str(item.cid)) return null;
  return { id: `ttc:${item.cid}`, fuente: 'tiktok', url: str(item.videoWebUrl) || str(item.submittedVideoUrl), autor: str(item.uniqueId) || str(item.uid) || `anon-${item.cid}`, fecha: str(item.createTimeISO), texto };
}

/** Hilo de comentarios de YouTube Data API v3 (commentThreads.list, part=snippet). */
export function normYtThread(item) {
  const top = item?.snippet?.topLevelComment;
  const s = top?.snippet;
  const texto = str(s?.textOriginal) || str(s?.textDisplay);
  if (!top?.id || !texto) return null;
  const videoId = str(s.videoId) || str(item.snippet.videoId);
  return {
    id: `ytc:${top.id}`,
    fuente: 'youtube',
    url: `https://www.youtube.com/watch?v=${videoId}&lc=${top.id}`,
    autor: str(s.authorChannelId?.value) || str(s.authorDisplayName) || `anon-${top.id}`,
    fecha: str(s.publishedAt),
    texto,
  };
}

/** Texto pegado a mano: un comentario por línea (o separados por líneas en blanco). */
export function parseManualPaste(texto, url, fecha) {
  const bloques = String(texto).split(/\n\s*\n/).flatMap((b) => (b.includes('\n') && b.split('\n').every((l) => l.trim().length > 0 && l.trim().length < 400) ? b.split('\n') : [b]));
  return bloques
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .filter((b) => b.length >= 15)
    .map((b, i) => ({ fuente: 'manual', url: str(url) || 'entrada manual', autor: `manual-${i}-${b.slice(0, 24)}`, fecha: str(fecha), texto: b }));
}

export async function sha256Hex(texto) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sustituye el nombre de usuario por un hash (privacidad). */
export async function anonymize(c, projectId) {
  const autor_hash = (await sha256Hex(`${c.fuente}:${c.autor}`)).slice(0, 16);
  const id = c.id || `man:${(await sha256Hex(c.texto)).slice(0, 20)}`;
  return { id: `${projectId}:${id}`, project_id: projectId, fuente: c.fuente, url: c.url, autor_hash, fecha: c.fecha, texto: c.texto.slice(0, 1500), procesado: false };
}

export function embedUrl(reel) {
  if (reel.plataforma === 'instagram') return `https://www.instagram.com/reel/${reel.shortcode}/embed/`;
  if (reel.plataforma === 'tiktok') return `https://www.tiktok.com/embed/v2/${reel.shortcode}`;
  return null;
}
