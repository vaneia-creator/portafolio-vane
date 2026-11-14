// Configuración central: umbrales, taxonomía, especificaciones por red y proveedores.
// Los umbrales son la propuesta metodológica del plan (calibrables y versionados).

export const DEFAULT_THRESHOLDS = Object.freeze({
  // Viralidad
  minAgeDays: 7, // reels con menos días se excluyen del ranking
  minReels: 12, // mínimo de reels elegibles por creador
  medianWindow: 30, // últimos N reels elegibles para la mediana
  megaOS: 10,
  viralOS: 3,
  viralAR: 1,
  viralZ: 2,
  aboveOS: 1.5,
  wZ: 0.5,
  wOS: 0.3,
  wEV: 0.2,
  // Dolores
  painMinAuthors: 15,
  painMinSources: 2,
  painMinIntensity: 3.5,
  painMinPay: 0.1,
  painMinRecency: 0.5,
  recencyMonths: 12,
  wFreq: 0.3,
  wInt: 0.25,
  wPay: 0.3,
  wRec: 0.15,
  trendsMinRatio: 0.9, // último cuarto ÷ primer cuarto del CSV; por debajo = decreciente
});

export const THRESHOLD_LABELS = {
  minAgeDays: 'Antigüedad mínima del reel (días)',
  minReels: 'Mínimo de reels elegibles por creador',
  medianWindow: 'Reels usados para la mediana',
  megaOS: 'Mega-viral: OS mínimo',
  viralOS: 'Viral: OS mínimo',
  viralAR: 'Viral: AR mínimo (vistas ÷ seguidores)',
  viralZ: 'Viral: z mínimo (vía alternativa)',
  aboveOS: 'Sobre la media: OS mínimo',
  wZ: 'Peso de z en el Score',
  wOS: 'Peso de ln(OS) en el Score',
  wEV: 'Peso del percentil de EV en el Score',
  painMinAuthors: 'Dolor válido: autores distintos mínimos',
  painMinSources: 'Dolor válido: fuentes distintas mínimas',
  painMinIntensity: 'Dolor válido: intensidad media mínima (1–5)',
  painMinPay: 'Dolor válido: fracción mínima con señal de pago',
  painMinRecency: 'Dolor válido: fracción mínima de menciones recientes',
  recencyMonths: 'Ventana de recencia (meses)',
  wFreq: 'Pain Score: peso de frecuencia',
  wInt: 'Pain Score: peso de intensidad',
  wPay: 'Pain Score: peso de disposición a pagar',
  wRec: 'Pain Score: peso de recencia',
  trendsMinRatio: 'Google Trends: razón mínima final ÷ inicio',
};

function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** Versión de fórmula: "v1" con los umbrales por defecto; "v1-<hash>" si se calibraron. */
export function formulaVersion(th) {
  const keys = Object.keys(DEFAULT_THRESHOLDS);
  const same = keys.every((k) => Number(th[k]) === DEFAULT_THRESHOLDS[k]);
  if (same) return 'v1';
  return 'v1-' + djb2(keys.map((k) => `${k}=${Number(th[k])}`).join(';'));
}

export const TAXONOMY = Object.freeze({
  CUR: { nombre: 'Curiosidad o bucle abierto', color: '#2563eb' },
  IDE: { nombre: 'Identificación', color: '#0d9488' },
  DOL: { nombre: 'Agitación de dolor', color: '#dc2626' },
  PRO: { nombre: 'Promesa o beneficio', color: '#16a34a' },
  URG: { nombre: 'Urgencia o escasez', color: '#ea580c' },
  SOC: { nombre: 'Prueba social', color: '#7c3aed' },
  AUT: { nombre: 'Autoridad propia', color: '#4f46e5' },
  CON: { nombre: 'Contraintuitivo', color: '#c026d3' },
  OBJ: { nombre: 'Manejo de objeción', color: '#0369a1' },
  NEG: { nombre: 'Negatividad o error', color: '#9f1239' },
  ESP: { nombre: 'Especificidad', color: '#a16207' },
  EXC: { nombre: 'Exclusividad o secreto', color: '#6d28d9' },
  CTA: { nombre: 'Llamado a la acción', color: '#be185d' },
  TRN: { nombre: 'Transición o retención', color: '#475569' },
});
export const TAXONOMY_CODES = Object.keys(TAXONOMY);

// Especificaciones por red (sección 6 del plan). `limites` son topes verificables en código;
// `guia` son reglas operativas de partida, no especificaciones oficiales.
export const NETWORKS = Object.freeze({
  instagram: {
    nombre: 'Instagram Reels',
    limites: { captionMax: 2200, hashtagsMax: 5, duracionMaxS: 180 },
    duracionRecomendadaS: [15, 60],
    notaDuracion: '15–60 s para alcance (consenso de terceros, no oficial). Máximo 3 min para ser recomendado a no seguidores.',
    guia: [
      'Formato 9:16, 1080×1920.',
      'Gancho visual y verbal en menos de 1 s; cortes cada 2–3 s; texto en pantalla con la promesa.',
      'Texto en pantalla dentro de zonas seguras: ~14 % superior y ~35 % inferior libres.',
      'Caption: máximo 2.200 caracteres (se ven ~125 antes de "más"); máximo 5 hashtags.',
      'Tono aspiracional y práctico.',
    ],
  },
  tiktok: {
    nombre: 'TikTok',
    limites: { captionMax: 4000, hashtagsMax: null, duracionMaxS: 600 },
    duracionRecomendadaS: [21, 34],
    notaDuracion: '21–34 s es la referencia de TikTok para anuncios In-Feed; no hay recomendación oficial para contenido orgánico.',
    guia: [
      'Formato 9:16 vertical.',
      'Gancho hablado inmediato; tono nativo y conversacional.',
      'Palabra clave al inicio del caption (búsqueda). Caption: máximo 4.000 caracteres en la app.',
      'Texto en pantalla con palabras clave buscables.',
      'Tono auténtico y directo.',
    ],
  },
  linkedin: {
    nombre: 'LinkedIn (video nativo)',
    limites: { captionMax: 3000, hashtagsMax: null, duracionMaxS: 600 },
    duracionRecomendadaS: [15, 30],
    notaDuracion: 'Menos de 30 s es la referencia de LinkedIn para anuncios de awareness (2018); no hay recomendación oficial para contenido orgánico.',
    guia: [
      'Vertical 4:5 o 9:16.',
      'Gancho en las 2 primeras líneas del texto y en los primeros 3 s del video.',
      'Subtítulos obligatorios y titular fijo en pantalla.',
      'Texto de la publicación: máximo 3.000 caracteres.',
      'Tono profesional, con aprendizaje, dato o caso concreto.',
    ],
  },
});

// Actores de Apify (esquemas de entrada/salida verificados contra la API de Apify el 2026-11-14).
// usdPorResultado = tarifa del plan Free publicada por cada actor en esa fecha.
export const ACTORS = Object.freeze({
  igReels: { id: 'apify~instagram-reel-scraper', usdPorResultado: 0.0026, usdInicio: 0.001 },
  igProfiles: { id: 'apify~instagram-profile-scraper', usdPorResultado: 0.0026, usdInicio: 0 },
  igComments: { id: 'apify~instagram-comment-scraper', usdPorResultado: 0.0026, usdInicio: 0 },
  igHashtag: { id: 'apify~instagram-hashtag-scraper', usdPorResultado: 0.0026, usdInicio: 0 },
  ttVideos: { id: 'clockworks~tiktok-scraper', usdPorResultado: 0.0037, usdInicio: 0 },
  ttComments: { id: 'clockworks~tiktok-comments-scraper', usdPorResultado: 0.00125, usdInicio: 0 },
});

// Límites diarios de las capas gratuitas (los del plan, noviembre de 2026). Se usan como contadores
// de seguridad; el límite real lo fija cada proveedor y la app también respeta sus errores 429.
export const DAILY_LIMITS = Object.freeze({
  groq_stt: { requests: 2000, audioSeconds: 28800 },
  groq_llm: { requests: 1000, tokens: 200000 },
  gemini: { requests: 500 },
  openrouter: { requests: 50 },
  youtube: { units: 10000, searches: 100 },
});

export const DEFAULT_MODELS = Object.freeze({
  groqStt: 'whisper-large-v3-turbo',
  groqLlm: 'openai/gpt-oss-120b',
  gemini: 'gemini-flash-lite-latest',
  openrouter: 'openrouter/free',
});

export const HEDGE_WORDS = ['tal vez', 'quizá', 'quizás', 'probablemente', 'posiblemente', 'a lo mejor', 'puede que'];
