// Transcripción (Groq Whisper) y comentarios de YouTube (Data API v3).

import { fetchJSON, ApiError } from './http.js';
import { getSettings, bump, overLimit } from './store.js';
import { normYtThread } from '../core/normalize.js';
import { parseJSON } from './llm.js';

const GROQ_STT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MAX_BYTES = 25 * 1024 * 1024; // tope de Groq en la capa gratuita

async function groqTranscribe(fuente, onLog) {
  const s = getSettings();
  const fd = new FormData();
  fd.append('model', s.models.groqStt);
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  fd.append('temperature', '0');
  if (fuente.url) fd.append('url', fuente.url); else fd.append('file', fuente.file, fuente.file.name || 'audio.mp4');
  const r = await fetchJSON(GROQ_STT, { method: 'POST', headers: { Authorization: `Bearer ${s.keys.groq}` }, body: fd },
    { proveedor: 'Groq Whisper', reintentos: 3, onWait: (ms) => onLog?.(`Groq Whisper pide esperar ${Math.ceil(ms / 1000)} s…`) });
  const words = (r?.words || []).filter((w) => typeof w.start === 'number' && typeof w.end === 'number' && String(w.word).trim());
  return { texto: String(r?.text || '').trim(), idioma: r?.language || null, duracion_s: typeof r?.duration === 'number' ? r.duration : null, words, modelo: s.models.groqStt };
}

/**
 * Transcribe un reel sin guardar el audio en ningún sitio:
 * 1) Groq lee la URL pública del video directamente; 2) si no puede, el navegador la descarga
 * en memoria y la envía; 3) si tampoco, se pide el archivo al usuario (`archivo`).
 */
export async function transcribeReel(reel, { archivo, onLog } = {}) {
  const s = getSettings();
  if (!s.keys.groq) throw new ApiError('Groq', 0, 'Falta la clave de Groq. Añádela en Configuración.');
  const tope = overLimit('groq_stt', { requests: 1, audioSeconds: reel.duration_s || 0 });
  if (tope) throw new ApiError('Groq', 0, tope);
  const cuenta = (r) => { bump('groq_stt', { requests: 1, audioSeconds: Math.round(r.duracion_s || reel.duration_s || 0) }); return r; };

  if (archivo) {
    if (archivo.size > MAX_BYTES) throw new ApiError('Groq', 0, 'El archivo supera los 25 MB que admite Groq en la capa gratuita.');
    return cuenta({ ...(await groqTranscribe({ file: archivo }, onLog)), via: 'archivo subido por el usuario' });
  }
  const urls = [reel.video_url, reel.audio_url].filter(Boolean);
  if (!urls.length) throw new ApiError('Transcripción', 0, 'Este reel no trae URL de video. Vuelve a traer las métricas o sube el archivo.');
  const errores = [];
  for (const url of urls) {
    try { return cuenta({ ...(await groqTranscribe({ url }, onLog)), via: 'URL leída por Groq' }); }
    catch (e) { errores.push(e.message); if (e.status === 401 || e.status === 429) throw e; }
  }
  onLog?.('Groq no pudo leer la URL; intento descargar el video en memoria desde el navegador…');
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (blob.size > MAX_BYTES) throw new Error('el video supera 25 MB');
      const file = new File([blob], 'reel.mp4', { type: blob.type || 'video/mp4' });
      return cuenta({ ...(await groqTranscribe({ file }, onLog)), via: 'descarga temporal en memoria' });
    } catch (e) { errores.push(`descarga directa: ${e.message}`); }
  }
  throw new ApiError('Transcripción', 0,
    `No se pudo obtener el audio (${errores.join(' | ')}). Las URL de video caducan a las pocas horas: vuelve a traer las métricas, o sube el archivo de video con el botón "Subir archivo".`);
}

// ---------- YouTube Data API v3 ----------
const YT = 'https://www.googleapis.com/youtube/v3';

function ytKey() {
  const k = getSettings().keys.youtube;
  if (!k) throw new ApiError('YouTube', 0, 'Falta la clave de YouTube Data API. Añádela en Configuración.');
  return k;
}

/** search.list: 100 unidades por llamada. Devuelve los videos más vistos para la consulta. */
export async function ytSearch(consulta, { max = 10, idioma = 'es' } = {}) {
  const tope = overLimit('youtube', { units: 100, searches: 1 });
  if (tope) throw new ApiError('YouTube', 0, tope);
  const q = new URLSearchParams({ part: 'snippet', type: 'video', order: 'viewCount', maxResults: String(max), q: consulta, relevanceLanguage: idioma, key: ytKey() });
  bump('youtube', { units: 100, searches: 1 });
  const r = await fetchJSON(`${YT}/search?${q}`, {}, { proveedor: 'YouTube', reintentos: 1 });
  return (r?.items || []).filter((i) => i.id?.videoId).map((i) => ({ videoId: i.id.videoId, titulo: i.snippet?.title || '', canal: i.snippet?.channelTitle || '', publicado: i.snippet?.publishedAt || null }));
}

/** commentThreads.list: 1 unidad por página de hasta 100 hilos. */
export async function ytComments(videoId, { paginas = 1 } = {}) {
  const out = [];
  let pageToken = '';
  for (let p = 0; p < paginas; p++) {
    const tope = overLimit('youtube', { units: 1 });
    if (tope) throw new ApiError('YouTube', 0, tope);
    const q = new URLSearchParams({ part: 'snippet', videoId, maxResults: '100', order: 'relevance', textFormat: 'plainText', key: ytKey() });
    if (pageToken) q.set('pageToken', pageToken);
    bump('youtube', { units: 1 });
    let r;
    try { r = await fetchJSON(`${YT}/commentThreads?${q}`, {}, { proveedor: 'YouTube', reintentos: 1 }); }
    catch (e) {
      const razon = e.body?.error?.errors?.[0]?.reason;
      if (razon === 'commentsDisabled' || e.status === 404) return { comentarios: out, omitido: 'comentarios desactivados o video no disponible' };
      throw e;
    }
    for (const it of r?.items || []) { const c = normYtThread(it); if (c) out.push(c); }
    pageToken = r?.nextPageToken || '';
    if (!pageToken) break;
  }
  return { comentarios: out, omitido: null };
}

export async function ytTest() {
  const q = new URLSearchParams({ part: 'snippet', chart: 'mostPopular', maxResults: '1', key: ytKey() });
  bump('youtube', { units: 1 });
  const r = await fetchJSON(`${YT}/videos?${q}`, {}, { proveedor: 'YouTube', reintentos: 0 });
  return { ok: Array.isArray(r?.items) };
}

// ---------- Gemini: análisis visual del video ----------
const GEMINI_MAX_BYTES = 14 * 1024 * 1024; // el pedido completo (video en base64 + texto) debe quedar por debajo de 20 MB

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('no se pudo leer el video en memoria'));
    r.readAsDataURL(blob);
  });
}

/** Envía el video a Gemini y devuelve el JSON que pide el prompt. Prueba el modelo de video y, si falla, el de respaldo. */
export async function geminiVideo(blob, { system, user }, onLog) {
  const s = getSettings();
  if (!s.keys.gemini) throw new ApiError('Gemini', 0, 'Falta la clave de Gemini (Configuración). Sin ella no se puede analizar lo visual.');
  if (blob.size > GEMINI_MAX_BYTES) throw new ApiError('Gemini', 0, `El video pesa ${(blob.size / 1048576).toFixed(1)} MB; Gemini admite hasta 14 MB enviados directamente.`);
  const data = await blobToBase64(blob);
  const mimeType = /^video\//.test(blob.type) ? blob.type : 'video/mp4';
  const modelos = [s.models.geminiVideo, s.models.gemini].filter((m, i, a) => m && a.indexOf(m) === i);
  const errores = [];
  for (const modelo of modelos) {
    const tope = overLimit('gemini', { requests: 1 });
    if (tope) throw new ApiError('Gemini', 0, tope);
    try {
      bump('gemini', { requests: 1 });
      const r = await fetchJSON(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(s.keys.gemini)}`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data } }, { text: user }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 8192 },
          }),
        }, { proveedor: 'Gemini', reintentos: 2, onWait: (ms) => onLog?.(`Gemini pide esperar ${Math.ceil(ms / 1000)} s…`) });
      const texto = (r?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!texto) throw new Error(`respuesta vacía${r?.candidates?.[0]?.finishReason ? ` (${r.candidates[0].finishReason})` : ''}`);
      return { json: parseJSON(texto), modelo: r?.modelVersion || modelo };
    } catch (e) {
      errores.push(`${modelo}: ${e.message}`);
      if (modelos.at(-1) !== modelo) onLog?.(`Gemini ${modelo} falló (${e.message}); pruebo con ${modelos.at(-1)}.`);
    }
  }
  throw new ApiError('Gemini', 0, errores.join(' | '));
}
