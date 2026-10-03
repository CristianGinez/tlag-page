# Juegos TeamLag — Spec

## Objetivo

Publicar juegos web hechos por el admin (generados con IA) dentro de tlag.online: un catálogo `/juegos`, una página por juego con reproductor a pantalla completa, guardado de partidas en la nube ligado a la cuenta, rankings, badges y, más adelante, torneos.

Primer juego: **TEAMLAG: Lima Infecta — Incidente Lupitox** (survival horror 3D con Three.js, un único `.html` de ~940 KB, guarda en `localStorage` con claves `tl_lima_*`).

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Quién sube juegos | Solo el admin. Sin envíos de la comunidad. |
| Origen de los juegos | Propios (hechos con IA), por lo que se pueden modificar. |
| Formato | Un `.html` autocontenido o una carpeta con assets. |
| Alojamiento | El mismo repo `tlag-page` (`public/juegos/<slug>/`), servido desde el subdominio `juegos.tlag.online`, que es un alias del mismo proyecto Vercel `tlag`. |
| Aislamiento | El juego corre en otro origen y no puede leer la sesión de Supabase de `www.tlag.online` (PKCE en `localStorage`). |
| Experiencia | Página del juego + botón JUGAR que abre una capa a pantalla completa. |
| Login | Se juega sin cuenta. El login solo es necesario para la nube, el ranking y los badges. |
| Guardado | Automático: el conector sincroniza las claves de `localStorage` con prefijo del juego. |
| Antitrampas | Casual al inicio; se endurece cuando haya torneos con premios. |
| Código fuente del juego | Vive fuera de `tlag-page` (repo privado propio). A la web solo sube el build. |

## Fases

1. **Vitrina:** subdominio, reglas de `vercel.json`, tabla `games`, `/juegos`, `/juegos/<slug>`, reproductor, `/admin/juegos`, contador de partidas.
2. **Conector + guardado en la nube:** `/_tl/connect.js`, tabla `game_saves`, `/api/games/saves`, sección "Tu partida".
3. **Ranking + badges:** tabla `game_scores`, `/api/games/scores`, `/api/games/achievement`, arreglo de `grant-badge`.
4. **Torneos:** solo el esbozo en este documento; tendrá su propia spec.

Cada fase se puede desplegar por separado y deja el sitio funcionando.

---

## 1. Alojamiento y dominio

### Subdominio

- En Vercel → proyecto `tlag` → Domains → añadir `juegos.tlag.online` (Production).
- En GoDaddy (DNS de `tlag.online`) → registro `CNAME juegos → <valor que indique Vercel>`.
- No tiene coste adicional.

### Archivos

```
public/juegos/
  README.md                  reglas para crear juegos compatibles (ver §3)
  _tl/connect.js             el conector
  lima-infecta/index.html    build de Lima Infecta
  <slug>/index.html (+ assets)
```

URL pública de un juego: `https://juegos.tlag.online/juegos/<slug>/`.

### Reglas en `vercel.json`

Los archivos de `public/` los sirve la CDN sin pasar por el middleware de Astro, así que el control por host se hace en `vercel.json` con `has: [{ "type": "host", "value": "juegos.tlag.online" }]`:

- **Host `juegos.tlag.online`:**
  - Cualquier ruta que no empiece por `/juegos/` → redirección a `https://www.tlag.online/juegos`.
  - Headers propios para `/juegos/(.*)`:
    - CSP del juego: `frame-ancestors https://www.tlag.online`, `default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:`, `connect-src 'self'`.
    - Sin `X-Frame-Options`.
    - `Cache-Control: public, max-age=31536000, immutable` (las URLs llevan `?v=`).
  - Para `/juegos/_tl/connect.js`: `Cache-Control: public, max-age=300`, porque el conector se actualiza sin cambiar de URL.
- **Host `www.tlag.online`:**
  - `/juegos/<slug>/index.html` y cualquier archivo dentro de `/juegos/<slug>/` → redirección a la página `/juegos/<slug>`. Así el juego nunca se ejecuta en el origen con sesión.
  - La CSP global añade `https://juegos.tlag.online` a `frame-src`.

Hay que verificar con un preview deploy que la regla de headers del host `juegos.` no se fusiona con la cabecera global (`X-Frame-Options: DENY`, `frame-ancestors 'none'`). Si Vercel combina ambas, la cabecera global se limita con `missing: [{ type: "host", value: "juegos.tlag.online" }]`.

### Ruta Astro vs. carpeta pública

La página `src/pages/juegos/[slug].astro` y la carpeta `public/juegos/<slug>/` comparten prefijo. En `www`, `/juegos/<slug>` (sin barra final ni archivo) lo resuelve Astro, y `/juegos/<slug>/...` lo redirige `vercel.json`. Hay que confirmar en el preview que `/juegos/lima-infecta` llega a la página Astro y no a `public/`. Si hay conflicto, la carpeta pública pasa a `public/g/<slug>/` y la URL del juego a `juegos.tlag.online/g/<slug>/`; el resto del diseño no cambia.

---

## 2. Catálogo, página del juego y reproductor (Fase 1)

### Tabla `games`

| Columna | Tipo | Notas |
|---|---|---|
| `slug` | text PK | `lima-infecta` |
| `title` | text | |
| `tagline` | text | una línea |
| `description` | text | markdown simple |
| `cover_url` | text | Cloudinary |
| `controls` | text | teclado / mando / táctil |
| `tags` | text[] | `terror`, `+13`, `pc-y-movil` |
| `play_url` | text null | null → `https://juegos.tlag.online/juegos/<slug>/` |
| `version` | int default 1 | se añade como `?v=` |
| `orientation` | text | `any` \| `landscape` |
| `status` | text | `draft` \| `published` \| `hidden` |
| `display_order` | int | |
| `published_at` | timestamptz null | se rellena al pasar a `published` |
| `plays` | bigint default 0 | |
| `save_prefix` | text null | `tl_lima_` (Fase 2) |
| `save_exclude` | text[] | `{tl_lima_settings}` (Fase 2) |
| `boards` | jsonb | Fase 3 |
| `badges` | jsonb | Fase 3 |
| `created_at`, `updated_at` | timestamptz | |

RLS: `select` público solo para `status = 'published'`. Las escrituras van por la API admin con el service client.

RPC `increment_game_plays(p_slug text)`: `security definer`, solo incrementa `plays` de juegos publicados.

### Feature `src/features/games/`

- `types.ts`: `Game`, `GameBoard`, `GameBadgeRule`.
- `lib/gamesData.ts`: `getGames()` (caché `games:all`, 300 s), `getGame(slug)` (caché `games:<slug>`, 300 s) y `getPlayUrl(game)`.
- `components/GameCard.astro`, `components/GameHero.astro`, `components/GamePlayer.tsx`, `components/GamesManager.tsx` (admin).
- `index.ts` (barrel).

### Rutas

- `/juegos`: grilla de `GameCard` por `display_order`. Badge "Nuevo" si `published_at` tiene menos de 14 días.
- `/juegos/[slug]`:
  - Hero con portada, título, tagline y tags, y botón JUGAR.
  - Descripción y controles; "Tu partida" (Fase 2) y ranking (Fase 3).
  - 404 si no existe o no está publicado. Los admins ven los `draft`: la página detecta admin en el cliente y pide la ficha a `/api/admin/games?slug=`.
- `/og/juego/[slug].png`: imagen OG con portada y título, con los helpers existentes de `shared/lib/og.ts`.
- `/admin/juegos`: CRUD con el patrón de `/admin/vips` (comprobación de admin en el cliente, Bearer token e `invalidateCache('games:all')` + `games:<slug>`).
- `/api/admin/games`: GET, POST, PATCH y DELETE con `requireAdmin` (tabla `admin_users`).
- Link "Juegos" en `Navbar.astro`.

### `GamePlayer.tsx`

- Al pulsar JUGAR:
  1. `POST /api/games/play` con `{ slug }`. Llama a la RPC `increment_game_plays`, con rate limit por IP en Upstash (1 por slug cada 60 s).
  2. Monta una capa `position: fixed; inset: 0; z-index` por encima del navbar, con fondo negro y un `<iframe>`:
     - `src = getPlayUrl(game) + '?v=' + version`
     - `allow="fullscreen; gamepad; autoplay"`
     - `sandbox="allow-scripts allow-same-origin allow-pointer-lock"`. Es seguro porque el origen es `juegos.tlag.online`.
  3. Intenta `requestFullscreen()` sobre la capa y `screen.orientation.lock('landscape')` si `orientation = landscape`. Si falla (iPhone), se queda la capa fija.
- Si `orientation = landscape` y el dispositivo está en vertical, muestra una pantalla "Gira tu teléfono" antes de arrancar.
- Salir: botón ✕ semitransparente en una esquina, o mantener Esc 1 s. El Esc corto pasa al juego.
- Al cerrar o en `astro:before-swap`: se elimina el iframe del DOM, se sale de la pantalla completa y se restaura el scroll.
- Mientras está abierto: `overflow: hidden` en `body` y `display: none` en los contenedores `.adsbygoogle`.
- Carga: portada + spinner hasta el `load` del iframe. A los 20 s, "No se pudo cargar" + Reintentar.

### Publicar un juego (flujo del admin)

1. En el repo fuente del juego: `npm run build`.
2. Copiar el `.html` a `public/juegos/<slug>/index.html`; commit y push.
3. En `/admin/juegos`: crear la ficha en `draft` y probarla.
4. Pasarla a `published`.
5. Para actualizar un juego ya publicado: reemplazar el archivo, push y subir `version` en el admin.

---

## 3. Conector (Fase 2)

Archivo `public/juegos/_tl/connect.js`, script clásico sin dependencias de ~3 KB. Cada juego lo carga antes de su propio código:

```html
<script src="/juegos/_tl/connect.js" data-game="lima-infecta" data-prefix="tl_lima_"></script>
```

El único cambio en el código del juego es esperar `TL.ready` antes de leer `localStorage`:

```js
await (window.TL && window.TL.ready);
```

En Lima Infecta: el `<script>` va en `src/template.html` y el `await` al inicio de `src/main.js`. Luego, recompilar.

### API expuesta al juego

- `TL.ready: Promise<void>`: se resuelve al recibir `init` o a los 3 s como máximo.
- `TL.event(name: string, data?: object)`: puntajes, logros (Fase 3).
- `TL.exit()`: pide a la web cerrar el reproductor.
- `TL.user: { name } | null`: disponible tras `ready`.

### Protocolo `postMessage`

Todos los mensajes llevan `{ tl: 1, type, ... }`.

| Dirección | Tipo | Contenido |
|---|---|---|
| juego → web | `hello` | `{ game, local: { [key]: at } }`, con las fechas locales conocidas |
| web → juego | `init` | `{ saves: { [key]: { value, at } }, user }` |
| juego → web | `save` | `{ items: [{ key, value, at }] }` |
| web → juego | `saved` / `save-error` | `{ keys }` / `{ reason }` |
| juego → web | `event` | `{ name, data }` |
| juego → web | `exit` | `{}` |

### Comportamiento del conector

- Fuera de un iframe (`window.parent === window`): resuelve `ready` de inmediato y no hace nada más.
- Al cargar: envía `hello` a `parent` con targetOrigin `https://www.tlag.online`.
- Al recibir `init` (validando `event.origin === 'https://www.tlag.online'`): por cada clave de la nube con `at` más reciente que la local, escribe `localStorage` y actualiza `__tl_meta`. Después resuelve `ready`.
- Envuelve `Storage.prototype.setItem` y `removeItem`. Para las claves de `localStorage` que empiezan por `data-prefix` y no son `__tl_meta`: registra `at = Date.now()` en `__tl_meta` y encola el cambio. La cola se envía en un `save` cada 2 s (debounce) y en `pagehide`.
- `__tl_meta` es un JSON `{ [key]: at }` en `localStorage`, separado por juego (`__tl_meta:<game>`).
- La lista `save_exclude` la aplica la web, que es quien conoce la ficha. El conector envía todo lo que tenga el prefijo.

### Lado web (`GamePlayer.tsx`)

- Solo acepta mensajes con `event.origin === 'https://juegos.tlag.online'` **y** `event.source === iframe.contentWindow`.
- Antes de crear el iframe, si hay sesión, hace `GET /api/games/saves?game=<slug>` para tener `init` listo.
- Al llegar `hello`:
  - Compara las fechas locales con las de la nube.
  - Si la local de una clave es más nueva y hay sesión, la marca para subirla cuando llegue el siguiente `save`. El conector reenvía en `save` todas las claves locales más nuevas tras `init`.
  - Responde `init`.
- Al llegar `save`: filtra por `save_prefix` y `save_exclude`, y hace `PUT /api/games/saves`. Muestra el indicador: "☁ Guardado" (2 s), "Sin conexión · guardado local" o, sin sesión, "Inicia sesión para guardar en la nube" (una sola vez por partida).
- Si el `PUT` falla, se reintenta con backoff (5 s, 15 s, 60 s) mientras el reproductor esté abierto. Lo que quede pendiente se vuelve a subir en la siguiente partida, gracias a la comparación de fechas.

### `public/juegos/README.md`

Las reglas para juegos nuevos, para pegarlas en el prompt de la IA:

1. Un único `index.html` o una carpeta autocontenida, sin peticiones a otros dominios.
2. Cargar `/juegos/_tl/connect.js` con `data-game` y `data-prefix`.
3. Hacer `await TL.ready` antes de leer guardados.
4. Guardar solo en `localStorage`, con claves que empiecen por el prefijo; máx. 256 KB por clave y 20 claves.
5. Opcional: `TL.event('score', …)`, `TL.event('completed')`, `TL.exit()`.
6. Que no exponga modos debug en el build publicado.

---

## 4. Guardado en la nube (Fase 2)

### Tabla `game_saves`

| Columna | Tipo |
|---|---|
| `user_id` | uuid → `auth.users` on delete cascade |
| `game_slug` | text → `games.slug` on delete cascade |
| `key` | text |
| `value` | text, check `octet_length(value) <= 262144` |
| `prev_value` | text null |
| `client_at` | timestamptz |
| `updated_at` | timestamptz default now() |

PK `(user_id, game_slug, key)`. RLS: `select`, `insert`, `update` y `delete` solo con `auth.uid() = user_id`.

### API `/api/games/saves`

Usa el cliente de Supabase **con el token del usuario** (header `Authorization`), de modo que RLS aplica.

- `GET ?game=<slug>` → `{ saves: { [key]: { value, at, hasPrev } } }`.
- `PUT { game, items: [{ key, value, at }] }`, con estas validaciones:
  - el juego existe y está publicado;
  - `key` empieza por `save_prefix` y no está en `save_exclude`;
  - `value` ≤ 256 KB;
  - el usuario no supera 20 claves en ese juego;
  - rate limit de 30 PUT/min por usuario (Upstash).
  
  Para cada item, solo escribe si `at` es más reciente que el `client_at` guardado. Al escribir, mueve el `value` anterior a `prev_value`.
- `POST ?game=<slug>&action=restore`: intercambia `value` ↔ `prev_value` en todas las claves del juego que tengan `prev_value`.
- `DELETE ?game=<slug>`: borra las filas del usuario para ese juego.

### "Tu partida" en `/juegos/[slug]`

Visible si hay sesión (componente React que lee `$currentUser`):

- "Guardado en la nube · hace X", usando el `updated_at` más reciente.
- **Restaurar versión anterior**: solo si alguna clave tiene `prev_value`; pide confirmación.
- **Borrar partida en la nube**: pide confirmación y avisa de que el guardado local de ese navegador se mantiene.
- Sin sesión: "Inicia sesión para guardar tu partida en la nube y seguir en cualquier dispositivo".

### Casos

| Situación | Resultado |
|---|---|
| Sin cuenta | Solo `localStorage`, como hoy. |
| Primer login con partida local | Las claves locales son más nuevas que la nube (vacía) y se suben. |
| Otro dispositivo | La nube es más nueva y se escribe en `localStorage` antes de `ready`. |
| Ambos lados cambiaron | Gana la más reciente por clave; la anterior queda en `prev_value`. |
| Sin internet | Guardado local; se sube en el siguiente `save` correcto o en la siguiente partida. |
| La web no responde en 3 s | `ready` se resuelve y el juego arranca con lo local. |

### Privacidad

Añadir en `src/content/legal/privacidad.md` que se guardan partidas, puntajes y logros de juegos ligados a la cuenta, y que se borran al eliminar la cuenta.

---

## 5. Ranking y badges (Fase 3)

### `games.boards`

```json
[{ "id": "default", "label": "Mejor tiempo", "order": "asc",
   "min": 600, "max": 36000, "min_play_seconds": 600 }]
```

`order`: `desc` (más alto gana) o `asc` (menos gana, p. ej. tiempo).

### Tabla `game_scores`

Columnas: `id`, `user_id`, `game_slug`, `board`, `score numeric`, `meta jsonb`, `play_seconds int`, `created_at`. Índice `(game_slug, board, score)`. RLS: `select` público e `insert` solo por API (service client). Al eliminar la cuenta, borrado en cascada.

### Flujo

1. El juego llama a `TL.event('score', { board, score, meta })`.
2. La web añade `play_seconds`, medido desde que se pulsó JUGAR.
3. Con sesión: `POST /api/games/scores`. Sin sesión: lo guarda pendiente en `sessionStorage`, muestra "Inicia sesión para entrar al ranking" y lo envía tras el login si la página sigue abierta.
4. La API valida:
   - que el juego esté publicado y el board exista;
   - `min ≤ score ≤ max`;
   - `play_seconds ≥ min_play_seconds`;
   - rate limit de 10/min por usuario.
   
   Inserta e invalida `scores:<slug>:<board>`.

### Ranking

RPC `get_game_leaderboard(p_slug, p_board, p_limit, p_since, p_until)`: mejor puntaje por usuario + nombre y avatar de `profiles`. `p_since`/`p_until` quedan para torneos. En la página: top 10 y "Tu mejor: #N". Caché de 60 s.

Admin: en `/admin/juegos`, ver los últimos puntajes y borrar uno.

### Badges de juegos

- `games.badges`: `[{ "event": "completed", "badge": "lima-sobreviviente" }]`. Los badges se crean en la tabla de badges existente.
- El juego llama a `TL.event('completed')` → la web llama a `POST /api/games/achievement { game, event }`.
- La API comprueba que el juego publicado tiene ese `event` mapeado y llama a la RPC `grant_badge` con el service client.
- La web lanza `achievement:unlocked` y se reutiliza el toast existente.

### Arreglo de seguridad: `/api/achievements/grant-badge`

Hoy cualquier usuario logueado puede otorgarse **cualquier** `badge_slug`. Se añade una lista blanca de badges autoasignables (`SELF_GRANTABLE = ['discord-conectado']`) y se responde 403 al resto. Los badges de juegos pasan por `/api/games/achievement`; los de admin, por `/api/admin/grant-badge`.

Además, el build publicado de Lima Infecta no debe exponer `window.__TL` (hoy se activa con `?debug`). Se desactiva en el build de producción del repo fuente.

---

## 6. Torneos (Fase 4 — esbozo)

- Tabla `game_tournaments`: `id`, `game_slug`, `board`, `title`, `starts_at`, `ends_at`, `status`, `prize_text`.
- El ranking del torneo es `get_game_leaderboard` con `p_since`/`p_until`: no se duplican puntajes.
- Al cerrar, el top 3 recibe un badge con `event_id`, como en Awards. Anuncio opcional por el bot de Discord.
- Si hay premios reales: revisión manual del top y pruebas en vídeo. Se define en su propia spec.

---

## Verificación

No hay tests automatizados en el repo. Por fase:

- `pnpm astro check` y `pnpm build` sin errores.
- En un preview deploy:
  - `juegos.tlag.online/juegos/lima-infecta/` carga.
  - `juegos.tlag.online/` redirige.
  - `www.tlag.online/juegos/lima-infecta/index.html` redirige a la página.
  - El iframe carga (sin bloqueo por `X-Frame-Options`/CSP).
  - En la consola del juego, `localStorage` no contiene claves `sb-*`.
- Reproductor: PC (Chrome, Firefox) y móvil (Android Chrome, iPhone Safari). Comprobar pantalla completa o capa fija, orientación, audio tras JUGAR, que al salir y al navegar no queda audio, y que no se ven anuncios encima.
- Guardado:
  1. Guardar en el PC con sesión.
  2. Abrir en el móvil con la misma cuenta y comprobar que la partida aparece.
  3. Guardar en el móvil, volver al PC y comprobar que gana la más nueva.
  4. Probar Restaurar y Borrar.
  5. Sin sesión, el guardado local funciona.
  6. Con la red cortada, aparece el indicador y la partida se sube al volver.
- Ranking: un puntaje fuera de rango o con `play_seconds` insuficiente → 400. Un `badge_slug` arbitrario en `grant-badge` → 403.

## Fuera de alcance

- Subida de juegos desde el navegador (R2 / panel de subida). Si un juego supera ~50 MB, se aloja aparte y se rellena `play_url`.
- Juegos de terceros o envíos de la comunidad.
- Multijugador en tiempo real.
- Mostrar el contenido de una partida (nivel, inventario) en la web.
