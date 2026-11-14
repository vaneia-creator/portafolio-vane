# Pruebas del Radar de Dolores y Reels

Esta carpeta no se sube a Hostinger.

- `node --test radar-tests/core.test.mjs` — fórmulas de viralidad, Pain Score y validadores.
- `NODE_PATH=$(npm root -g) node radar-tests/e2e.mjs` — recorrido completo en Chromium (requiere Playwright).
  La parte A llama de verdad a Groq y Apify con una clave falsa; la parte B usa respuestas
  simuladas con la forma publicada por cada API. Esos datos simulados solo existen en la prueba.
