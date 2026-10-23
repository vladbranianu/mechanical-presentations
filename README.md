# Mechanical Presentations

Platformă web cu prezentări tehnice 3D interactive (motoare, mecanisme, transmisii).
Vite + React + React Three Fiber, site static.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + build în dist/
```

## Structură

```
src/
  pages/Home.tsx               listarea (fără three.js, doar thumbnail-uri statice)
  pages/PresentationPage.tsx   încarcă prezentarea la cerere (/p/:slug)
  framework/                   comun tuturor prezentărilor
    Viewer.tsx                 scena + titlu + hotspots + panoul piesei + bara de jos
    SceneRuntime.tsx           în <Canvas>: build/dispose, update pe frame, cameră orbit
                               cu zbor animat, click pe piese, poziționarea overlay-urilor
    types.ts                   contractul unei prezentări (PresentationModule)
    ui.tsx                     butoane, slidere, useTicker
    three/section.ts           moduri Secțiune / Asamblat / X-ray (planuri de tăiere + fețe roșii)
    three/geometry.ts          helperi pentru modelare procedurală (rbox, cyl*, bolts, tube, texturi)
  presentations/
    catalog.ts                 lista prezentărilor (metadate + import dinamic)
    flat-six/                  prima prezentare
```

three.js și codul scenei se descarcă doar când deschizi o prezentare; pagina de listare
încarcă ~85 kB gzip.

## Cum adaugi o prezentare

1. Creează `src/presentations/<slug>/index.ts` care exportă default un `PresentationModule`:
   - `scene`: fundal, fov, limite de zoom, expunere.
   - `initialParams`: parametrii proprii (ex. turație), editați de `Controls`.
   - `build(ctx)`: construiește scena (geometrie procedurală sau un glTF încărcat) și
     întoarce `root`, `parts` (textul fiecărei piese, cadrul de cameră, ancora hotspot-ului),
     `pickables`, `modes`, `update()` pe frame și `dispose()`.
   - opțional `Hud` / `Controls`: componente React pentru bara de jos.
2. Adaugă intrarea în `src/presentations/catalog.ts`.
3. Generează thumbnail-ul: `npm run build && npm run preview`, apoi în alt terminal
   `npm run thumbnails -- <slug>` (cere un Chromium pentru Playwright:
   `npx playwright install chromium`). Scrie `public/thumbnails/<slug>.jpg`.

Pentru modele complexe, pune fișierul `.glb` în `public/models/<slug>/` și încarcă-l în
`build()` cu `GLTFLoader`; restul framework-ului (hotspots, panou, moduri) rămâne identic.

## Deploy

Orice host static: `npm run build`, publică `dist/`. Rutele sunt client-side; fallback-ul
spre `index.html` e deja configurat pentru Netlify / Cloudflare Pages (`public/_redirects`)
și Vercel (`vercel.json`).
