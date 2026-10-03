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
public/g/
  README.md                  reglas para crear juegos compatibles (ver §3)
  _tl/connect.js             el conector
  lima-infecta/index.html    build de Lima Infecta
  <slug>/index.html (+ assets)
```

URL pública de un juego: `https://juegos.tlag.online/g/<slug>/index.html` (con `index.html` explícito, porque el servidor de desarrollo no lo resuelve en URLs de carpeta). Se usa `/g/` (y no `/juegos/`) para que la carpeta pública no choque con la página Astro `/juegos/<slug>`: en Vercel los archivos estáticos se resuelven antes que las funciones.

### Reglas en `vercel.json`

Los archivos de `public/` los sirve la CDN sin pasar por el middleware de Astro, así que el control por host se hace en `vercel.json` con `has` / `missing` sobre el host `juegos.tlag.online`:

- **Host `juegos.tlag.online`:**
  - Cualquier ruta que no empiece por `/g/` → redirección a `https://www.tlag.online/juegos`.
  - Headers para `/g/` (excepto `/g/_tl/`):
    - CSP del juego: `default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src 'self'; frame-ancestors https://www.tlag.online; object-src 'none'; base-uri 'self'`.
    - Sin `X-Frame-Options`.
    - `Cache-Control: public, max-age=31536000, immutable` (las URLs llevan `?v=`).
  - Para `/g/_tl/(.*)`: la misma CSP y `Cache-Control: public, max-age=300`, porque el conector se actualiza sin cambiar de URL.
- **Resto de hosts (`www`):**
  - `/g/:slug/:path*` → redirección a la página `/juegos/:slug`. Así el juego nunca se ejecuta en el origen con sesión.
  - La regla global de headers lleva `missing: [{ "type": "host", "value": "juegos.tlag.online" }]`. Vercel aplica **todas** las reglas de headers que coinciden, así que sin esto el `X-Frame-Options: DENY` global bloquearía el iframe.
  - La CSP global añade `https://juegos.tlag.online` a `frame-src`.

### Orígenes configurables

Las reglas por host solo se cumplen en producción: los previews son `*.vercel.app` y el desarrollo local es `localhost:4321`. Por eso los orígenes no se escriben fijos en el código de la web:

- `PUBLIC_SITE_ORIGIN` (por defecto `https://www.tlag.online`).
- `PUBLIC_GAMES_ORIGIN` (por defecto `https://juegos.tlag.online`).
- **En desarrollo:** la web corre en `http://localhost:4321` y los juegos se cargan desde `http://127.0.0.1:4321`. Son orígenes distintos para el navegador, así que el aislamiento y el `postMessage` se prueban de verdad en local.
- **El conector** (archivo estático) tiene una lista blanca de orígenes padre: `https://www.tlag.online`, `http://localhost:4321`.
- **En previews de Vercel** no hay subdominio de juegos. La verificación de las reglas por host se hace en producción tras el merge.

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
| `play_url` | text null | null → `${PUBLIC_GAMES_ORIGIN}/g/<slug>/index.html` |
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
  - 404 si no existe o no está publicado. Los `draft` se prueban desde `/admin/juegos` con el botón **Probar**, que abre el mismo reproductor sin pasar por la página pública.
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
  3. La capa fija ya cubre toda la ventana. Un botón ⛶ opcional pide la pantalla completa real (`requestFullscreen()`); no se pide automáticamente porque en pantalla completa el navegador se queda con la tecla Esc, y Lima Infecta la usa para pausar.
- Si `orientation = landscape` y el dispositivo está en vertical, muestra una pantalla "Gira tu teléfono" antes de arrancar.
- Salir: botón ✕ semitransparente en una esquina, o `TL.exit()` desde el juego. No se usa Esc: mientras el juego tiene el foco, las teclas llegan al iframe y la web no las ve.
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

Archivo `public/g/_tl/connect.js`, script clásico sin dependencias de ~3 KB. Cada juego lo carga antes de su propio código:

```html
<script src="/g/_tl/connect.js" data-game="lima-infecta" data-prefix="tl_lima_"></script>
```

El único cambio en el código del juego es esperar `TL.ready` antes de leer `localStorage`, **dentro de una función async** (los builds `iife` de esbuild no admiten `await` de nivel superior):

```js
async function boot() {
  if (window.TL) await window.TL.ready;
  // ... resto del arranque
}
```

En Lima Infecta: el `<script>` va en `src/template.html` y la línea `if (window.TL) await window.TL.ready;` al inicio de `boot()` en `src/main.js`, que ya es async. Luego, recompilar.

### API expuesta al juego

- `TL.ready: Promise<void>`: se resuelve al recibir `init` o a los 8 s como máximo. El conector repite `hello` cada 500 ms hasta recibir `init`, y la web precarga las partidas de la nube al abrir la página para responder rápido.
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
- Al cargar: envía `hello` a `parent` una vez por cada origen de la lista blanca (el navegador solo lo entrega al que coincide). Al llegar `init`, recuerda `event.origin` y desde ahí solo envía a ese origen.
- Al recibir `init` (validando que `event.origin` está en la lista blanca): por cada clave de la nube con `at` más reciente que la local, la escribe con el `setItem` **original** (no el envuelto, para que no se reencole) y guarda en la meta el `at` **de la nube**, no la hora actual. Después resuelve `ready` y encola las claves locales más nuevas que la nube.
- Envuelve `Storage.prototype.setItem` (solo cuando `this === localStorage`). Para las claves que empiezan por `data-prefix`: registra `at = Date.now()` en la meta y encola el cambio. La cola se envía en un `save` cada 2 s (debounce) y en `pagehide`. Los borrados (`removeItem`) no se sincronizan.
- La meta es un JSON `{ [key]: at }` guardado en la clave `__tl_meta:<game>` de `localStorage`.
- La lista `save_exclude` la aplica la web, que es quien conoce la ficha. El conector envía todo lo que tenga el prefijo.

### Lado web (`GamePlayer.tsx`)

- Solo acepta mensajes con `event.origin === PUBLIC_GAMES_ORIGIN` **y** `event.source === iframe.contentWindow`.
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
2. Cargar `/g/_tl/connect.js` con `data-game` y `data-prefix`.
3. Hacer `if (window.TL) await window.TL.ready;` dentro de la función async de arranque, antes de leer guardados.
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
  
  Toda la escritura la hace **una función SQL** `upsert_game_saves(p_game, p_items)` (security invoker, usa `auth.uid()`), para que no haya carreras entre pestañas o dispositivos. Por cada item: valida prefijo, exclusiones, tamaño y el límite de 20 claves; solo escribe si `at` es más reciente que el `client_at` guardado; al escribir, mueve el `value` anterior a `prev_value`. Devuelve las claves escritas y las rechazadas.
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
| La web no responde en 8 s | `ready` se resuelve y el juego arranca con lo local. |

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

Se añade **vitest** para la lógica pura (URL del juego, filtrado de claves sincronizables y el conector, probado con dobles de `localStorage` y `postMessage`). Por fase:

- `pnpm test`, `pnpm astro check` y `pnpm build` sin errores.
- En local (web en `localhost:4321`, juegos en `127.0.0.1:4321`): el iframe carga, el `postMessage` funciona y, en la consola del juego, `localStorage` no contiene claves `sb-*`.
- En producción, tras el merge (las reglas por host no existen en previews):
  - `juegos.tlag.online/g/lima-infecta/index.html` carga.
  - `juegos.tlag.online/` redirige.
  - `www.tlag.online/g/lima-infecta/` redirige a la página `/juegos/lima-infecta`.
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
