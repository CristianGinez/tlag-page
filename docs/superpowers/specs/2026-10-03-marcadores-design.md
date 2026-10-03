# Marcadores online (Fase 3) — Spec

## Objetivo

Que **Lima Infecta** tenga un apartado **Marcadores** en su menú principal, visible tras completar el juego una vez, con **tus marcas** y **las de los demás jugadores**, online. Las mismas tablas se ven también en la web, en `/juegos/lima-infecta`. Es la base de los torneos futuros.

Se construye sobre las fases 1 y 2 (`docs/superpowers/specs/2026-10-03-juegos-design.md`): juego aislado en `juegos.tlag.online`, conector `/g/_tl/connect.js` y puente `useGameBridge`.

## Decisiones

| Tema | Decisión |
|---|---|
| Métrica | **Mejor tiempo** (menos es mejor). El rango S/A/B/C se muestra junto al tiempo. |
| Tablas | **Una por dificultad**: `facil`, `normal`, `clasico`. |
| Tus marcas | Tu mejor tiempo y posición (#N) por tabla + tus **últimas 10** partidas completadas. |
| Dónde | **En el juego** (menú) **y en la web** (página del juego). |
| Quién publica | Solo con sesión. Sin sesión, la marca queda pendiente y se publica al volver con sesión. |
| Antitrampas | Casual: rango de tiempo por tabla (mínimo 600 s, editable en admin), sesión obligatoria, límite de envíos, sin `?debug` en el build, borrado manual en admin. |
| Datos al juego | **Petición y respuesta por el conector** (`TL.request`). El juego nunca ve el token ni llama a la API. |

---

## 1. Datos (Supabase)

### `games.boards` (jsonb, nueva columna, por defecto `[]`)

```json
[{ "id": "facil",   "label": "Fácil",   "min_s": 600, "max_s": 36000 },
 { "id": "normal",  "label": "Normal",  "min_s": 600, "max_s": 36000 },
 { "id": "clasico", "label": "Clásico", "min_s": 600, "max_s": 36000 }]
```

La migración rellena este valor en `lima-infecta`.

### Tabla `game_scores`

| Columna | Tipo |
|---|---|
| `id` | bigint identity PK |
| `user_id` | uuid → `auth.users` on delete cascade |
| `game_slug` | text → `games.slug` on delete cascade |
| `board` | text |
| `time_ms` | int, check `> 0` |
| `rank` | text, check en `('S','A','B','C')` |
| `stats` | jsonb, por defecto `'{}'`, check `octet_length(stats::text) <= 2048` |
| `created_at` | timestamptz default now() |

- Índice `(game_slug, board, time_ms)` e índice `(user_id, game_slug, created_at desc)`.
- RLS activada con **solo** `select` público (`using (true)`). **Sin** políticas de insert, update ni delete para `anon` o `authenticated`: las escrituras entran solo por la RPC `submit_game_score` (security definer). El borrado lo hace el admin con el service role.

### RPCs

- **`submit_game_score(p_game text, p_board text, p_time_ms int, p_rank text, p_stats jsonb) returns jsonb`**
  - **security definer**, `search_path = public`, ejecutable solo por `authenticated`.
  - Valida:
    - que `auth.uid()` no sea null;
    - que el juego esté publicado;
    - que `p_board` exista en `games.boards`;
    - que `p_time_ms` esté entre `min_s*1000` y `max_s*1000`;
    - que `p_rank` sea S/A/B/C;
    - que `p_stats` sea un objeto de ≤ 2 KB.
  - Inserta la marca y devuelve `{ "status": "published", "pos": <posición del mejor tiempo del usuario en esa tabla> }`.
  - Errores: `not_authenticated`, `game_not_found`, `bad_board`, `time_out_of_range`, `bad_rank`, `bad_stats`.
- **`get_game_leaderboard(p_game text, p_board text, p_limit int default 10) returns table(pos int, user_id uuid, name text, avatar text, time_ms int, rank text, created_at timestamptz)`**
  - **security definer**, porque necesita leer `display_name` y `avatar_url` de `profiles`, cuya RLS restringe la lectura. Solo devuelve esos dos campos públicos.
  - Toma la mejor marca por usuario (menor `time_ms`; empate → el más antiguo), ordena por `time_ms asc, created_at asc` y numera con `row_number()`.
  - `name` = `coalesce(display_name, 'Jugador')`. `p_limit` se acota a 50.
  - Ejecutable por `anon` y `authenticated`.
- **`get_my_game_scores(p_game text) returns jsonb`**
  - security definer, porque las posiciones se calculan frente a todos. Usa `auth.uid()`.
  - Devuelve `{ "boards": { "<board>": { "time_ms", "rank", "pos" } }, "history": [ { "board", "time_ms", "rank", "stats", "created_at" } × 10 ] }`.
  - Ejecutable solo por `authenticated`.

---

## 2. API (`src/pages/api/games/scores.ts`, `.../scores/me.ts`)

- **`POST /api/games/scores`** (Bearer)
  - Body `{ game, board, time_ms, rank, stats }`; rate limit `game-scores` de 5/min por usuario.
  - Llama a la RPC con `createUserClient(token)` e invalida la caché `scores:<game>:<board>`.
  - Errores de la RPC: `time_out_of_range`, `bad_*` → 400; `game_not_found` → 404; `not_authenticated` → 401.
- **`GET /api/games/scores?game=&board=`** (público): `{ rows }`. Caché `scores:<game>:<board>` de 60 s; no cachea errores (mismo patrón que `gamesData`).
- **`GET /api/games/scores/me?game=`** (Bearer): resultado de `get_my_game_scores`.
- **`DELETE /api/admin/games/scores?id=`** (admin): borra una marca con el service client e invalida la caché de su tabla.
- **`GET /api/admin/games/scores?game=`** (admin): las últimas 50 marcas con nombre, para moderar.

---

## 3. Conector: `TL.request`

### API para el juego

```js
const res = await TL.request(name, params); // resuelve con data o rechaza con Error(code)
```

- Envía `{ tl:1, type:'request', game, id, name, params }` al `parentOrigin`. `id` es un contador incremental.
- La web responde `{ tl:1, type:'response', id, ok:true, data }` o `{ ok:false, error }`.
- Sin respuesta en **8 s** → rechaza con `timeout`.
- Si aún no hay `parentOrigin` (antes de `init`), espera a `TL.ready`. Si tras `ready` sigue sin `parentOrigin` (juego fuera de la web), rechaza con `offline`.
- En el modo noop (fuera de iframe), `TL.request` rechaza al instante con `offline`.
- Solo se aceptan respuestas con `e.source === parent` y `e.origin === parentOrigin`.

### Lista blanca en la web (`useGameBridge`)

| `name` | `params` | Qué hace | `data` |
|---|---|---|---|
| `leaderboard` | `{ board }` | `GET /api/games/scores` | `{ rows: [{ pos, name, time_ms, rank, me }] }` (`me: true` en la fila del usuario actual) |
| `myScores` | — | Sin sesión → `{ login: true }`. Con sesión → `GET /api/games/scores/me` | `{ boards, history }` |
| `submitScore` | `{ board, time_ms, rank, stats }` | Sin sesión → guarda pendiente y `{ status:'pending_login' }`. Con sesión → POST | `{ status:'published', pos }` / `{ status:'rejected', reason }` / `{ status:'pending_login' }` |

- Cualquier otro `name` → `{ ok:false, error:'unknown_request' }`.
- En modo `preview` (Probar del admin): `submitScore` responde `{ status:'rejected', reason:'preview' }` sin publicar. Las lecturas funcionan igual.
- Al juego no se le envían `avatar` ni `user_id`; solo `pos`, `name`, `time_ms`, `rank` y `me`.

### Marcas pendientes

- En el `localStorage` de la web, clave `tl_pending_scores:<slug>`: un array de como mucho 5 envíos (los más recientes).
- Al abrir el reproductor con sesión, el puente publica los pendientes (POST uno por uno) y los quita si responden 2xx o 400 (el 400 se descarta porque nunca será válido).

---

## 4. Lima Infecta (repo fuente `lima-infecta-src`)

### Envío al terminar (`src/ui/end.js`)

- En el constructor de `EndScene`, tras calcular el rango: si `window.TL`, llama a `TL.request('submitScore', { board: G.diff, time_ms: Math.round(G.time * 1000), rank, stats: { saves, kills, docs, docsTotal, accuracy, heals } })`.
- El estado se dibuja bajo el sello de rango, junto a "Gracias por jugar":
  - `published` → "Tiempo publicado · #N en <Dificultad>"
  - `pending_login` → "Inicia sesión en tlag.online para publicar tu tiempo"
  - `rejected` / error / `offline` / `timeout` → no se muestra nada (el juego fuera de la web o sin red no molesta al jugador).

### Menú principal (`src/ui/title.js`)

- `opts` pasa a ser una lista de entradas con id: `nueva`, `continuar`, `marcadores` (solo si `this.clear`), `opciones`, `controles`, `ayuda`. El `switch` usa el id, no el índice, así que insertar la opción no rompe nada.
- "Marcadores" va justo después de "Continuar".

### Pantalla `LeaderboardScene` (nuevo `src/ui/leaderboard.js`)

- Mismo estilo que `SaveScene` y `DiffScene`: fondo oscuro, `panel`, `T`/`TS`, `hints`, colores `#ffd070` / `#a89a80`.
- **Pestañas** Fácil / Normal / Clásico (izquierda/derecha). Empieza en la dificultad de tu mejor rango, o en Normal.
- **Dos vistas** (arriba/abajo o una tecla): **Global** y **Tus marcas**.
  - **Global:** top 10 con `#`, nombre, tiempo (`fmtTime`) y rango. Si estás en el top se resalta tu fila; si no, al final aparece "Tú: #N · tiempo".
  - **Tus marcas:** tu mejor tiempo y posición en las tres tablas, y la lista de tus últimas 10 partidas (fecha, dificultad, tiempo, rango).
- **Estados:**
  - "Cargando…";
  - "Sin conexión con TeamLag" (`offline` / `timeout`; en este caso se muestran tus mejores marcas locales de `tl_lima_clear`);
  - "Inicia sesión en tlag.online para ver tus marcas" (`myScores` → `login`);
  - "Aún no hay marcas" (tabla vacía).
- Cachea las respuestas mientras la escena está abierta (no repite la petición al cambiar de pestaña).
- Para saber cuál es tu fila, `leaderboard` no devuelve `user_id`: la web marca la fila del usuario actual con `me: true` dentro de `rows`.

### Build

- `const DEBUG = false;` en `src/main.js`. Así `?debug` ya no expone `window.__TL` en producción.
- Recompilar y copiar a `public/g/lima-infecta/index.html`.
- Subir `version` del juego en el admin.

---

## 5. Web

- **`LeaderboardPanel.tsx`** en la página `/juegos/[slug]`:
  - Solo si `game.boards.length > 0`, debajo de la descripción.
  - Pestañas por tabla, top 10 con avatar, nombre, tiempo y rango, y "Tu mejor: #N" si hay sesión.
  - Datos de `GET /api/games/scores` y `/me`.
- **Admin `/admin/juegos`:**
  - En el formulario del juego, una fila por tabla con **tiempo mínimo y máximo (s)** editables, que se guardan en `boards`.
  - Sección **Marcas recientes** con las últimas 50 marcas (jugador, tabla, tiempo, rango, fecha) y un botón **Borrar**.
- **Tipos:** `GameBoard { id, label, min_s, max_s }`, `Game.boards: GameBoard[]`, `ScoreRow`, `MyScores`.
- **Formato de tiempo:** helper puro `formatTime(ms)` → `h:mm:ss` o `m:ss`, con test.
- **`public/g/README.md`:** documentar `TL.request` y los nombres disponibles.

## Verificación

- `pnpm test`: tests del conector (`request` resuelve, rechaza por timeout, rechaza offline, ignora respuestas de otro origen), de `formatTime` y de la lógica pura de pendientes (añadir con tope de 5, quitar).
- SQL (transacción con `rollback`, como en la fase 2):
  - insertar una marca válida, una fuera de rango y una con tabla inexistente;
  - que un `insert` directo en `game_scores` como `authenticated` **falle**;
  - que el leaderboard dé la mejor marca por usuario y las posiciones correctas;
  - que `get_my_game_scores` devuelva el historial.
- Navegador (local `localhost` ↔ `127.0.0.1`):
  - tras completar, el menú muestra Marcadores;
  - las pestañas cargan;
  - sin sesión aparece el aviso;
  - con sesión, una marca publicada aparece en el juego y en la web;
  - "Probar" del admin no publica.

## Fuera de alcance

- Torneos (ventanas de fechas sobre estas tablas): fase 4, que reutiliza `get_game_leaderboard` añadiéndole fechas.
- Badges por posición o rango.
- Validación fuerte (replays, revisión de vídeos).
