# Juegos de TeamLag (`/g/<slug>/`)

Cada carpeta es un juego publicado. Se sirve desde `https://juegos.tlag.online/g/<slug>/index.html` (origen aislado: el juego no puede leer la sesión de la web).

## Publicar un juego
1. Compilar el juego en su propio repo y copiar el build a `public/g/<slug>/index.html` (+ assets).
2. Commit + push.
3. `/admin/juegos` → Nuevo juego (estado Borrador) → **Probar** → Publicado.
4. Para actualizar: reemplazar archivos, push y **+ Versión** en el admin.

## Reglas para juegos nuevos (pegar en el prompt de la IA)
1. Un `index.html` autocontenido (o carpeta con rutas relativas). Sin peticiones a otros dominios.
2. Cargar el conector antes del código del juego:
   ```html
   <script src="/g/_tl/connect.js" data-game="<slug>" data-prefix="<prefijo_>"></script>
   ```
3. Esperar los guardados de la nube dentro de la función async de arranque (no usar `await` de nivel superior):
   ```js
   async function boot() {
     if (window.TL) await window.TL.ready;
     // ...arranque
   }
   ```
4. Guardar solo en `localStorage`, con claves que empiecen por el prefijo. Máximo 256 KB por clave y 20 claves.
5. Opcional: `TL.event('score', { board, score })`, `TL.event('completed')`, `TL.exit()`.
6. Sin modos debug activables por URL en el build publicado.
7. Datos online (marcadores): `await TL.request('leaderboard', { board })`, `await TL.request('myScores')`, `await TL.request('submitScore', { board, time_ms, rank, stats })`. Rechaza con `offline`/`timeout` si no hay conexión: el juego debe seguir funcionando.
8. Logros para el perfil: `await TL.request('unlockAchievement', { id })` → `{ status: 'granted' | 'already' | 'pending_login' | 'rejected' }`. No hay cola: si no hay sesión, pídelo otra vez la próxima vez que se cumpla la condición. Cada id se registra en `src/features/games/lib/achievements.ts` y apunta a un badge de la tabla `badges` (crearlo con una migración).
