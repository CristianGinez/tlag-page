# Marcadores online (Fase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marcadores online por dificultad (mejor tiempo) para Lima Infecta: publicar marcas al terminar el juego, verlas dentro del juego (menú Marcadores) y en la web, con moderación en el admin.

**Architecture:** Tabla `game_scores` escrita solo vía RPC `security definer` con validación; lectura pública vía RPCs que calculan la mejor marca por jugador y la posición. La web expone `/api/games/scores` y el puente `useGameBridge` atiende `TL.request` del conector (petición/respuesta por `postMessage`), delegando en un módulo puro `scoreRequests.ts`. Lima dibuja la pantalla en su propio canvas.

**Tech Stack:** Astro 5 SSR, React 19, Supabase (Postgres/RLS/RPC), Upstash (caché y rate limit), vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-marcadores-design.md` (se apoya en `docs/superpowers/specs/2026-10-03-juegos-design.md`).

## Global Constraints

- pnpm en `tlag-page`; `git add` con rutas explícitas (nunca `-A` ni `.`); commits en español con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Rama `feat/juegos`. **No hacer push ni merge a `main`.**
- `pnpm astro check` tiene 69 errores preexistentes: tus archivos no deben añadir ninguno. Filtro: `pnpm astro check 2>&1 | grep -E "games|juegos|scores|connect|Leaderboard" ; echo "exit=$?"`. El resultado esperado es `exit=1`.
- Tablas de Lima: `facil`, `normal`, `clasico`; tiempo mínimo 600 s y máximo 36000 s.
- Regex: slug `^[a-z0-9-]+$`; board `^[a-z0-9_-]{1,32}$`; rango en `S|A|B|C`; `stats` un objeto de ≤ 2048 bytes.
- Rate limit de POST: `checkRateLimit('game-scores', 5, '1 m', userId)`.
- Caché del top público: clave `scores:<game>:<board>`, TTL 60 s. Nunca se cachea un error.
- Petición del conector: espera máxima `8000` ms; errores `offline`, `timeout`, `unknown_request` y `bad_params`.
- Pendientes: clave `tl_pending_scores:<slug>` en el `localStorage` de la web, como mucho 5.
- Al juego nunca se le envían `user_id`, `avatar` ni el token.
- **Los subagentes no aplican SQL ni usan herramientas de Supabase.** Solo escriben los archivos.

## Review Focus

1. **Escritura directa en `game_scores` saltándose la validación** (PostgREST con el token de un usuario) → el SQL revoca insert/update/delete. La comprobación con `rollback` está en el paso C1 del controlador.
2. **Respuesta de `TL.request` desde otra ventana u otro origen, o con un `id` desconocido** → se ignora. Test en Task 4.
3. **Juego fuera de la web o sin `init`** → `TL.request` rechaza con `offline` sin quedarse colgado. Test en Task 4.
4. **Envío sin sesión** → la marca queda pendiente (con tope de 5) y se publica al volver con sesión; un 400 se descarta y no se reintenta para siempre. Tests en Task 3.
5. **`params` mal formados desde el juego** (tabla con caracteres raros, `time_ms` que no es número, `stats` no-objeto) → `bad_params` sin llamar a la API. Test en Task 3.

---

## Pasos del controlador

- **C1, tras la Task 1, con el OK del usuario:** aplicar `supabase/migrations/20261003140000_game_scores.sql` a Supabase. Después ejecutar, dentro de una transacción con `rollback`, como `authenticated` y con `request.jwt.claims.sub` de un usuario real:
  - `submit_game_score` válido → `published`;
  - `time_ms` = 1000 → error `time_out_of_range`;
  - board `x` → error `bad_board`;
  - `insert into game_scores` directo → error de permiso;
  - `get_game_leaderboard` → una fila con `is_me = true`;
  - `get_my_game_scores` → contiene `boards.normal` y `history`.
- **C2, Task 8:** se ejecuta **cuando el usuario entregue la versión mejorada de Lima**, sobre ese código fuente.

---

### Task 1: Migración SQL de marcadores (solo archivo)

**Files:**
- Create: `supabase/migrations/20261003140000_game_scores.sql`

**Interfaces:**
- Produces:
  - columna `games.boards jsonb`;
  - tabla `game_scores`;
  - RPC `submit_game_score(p_game text, p_board text, p_time_ms int, p_rank text, p_stats jsonb) returns jsonb` → `{status:'published', pos:int}`; errores `not_authenticated`, `game_not_found`, `bad_board`, `time_out_of_range`, `bad_rank`, `bad_stats`;
  - RPC `get_game_leaderboard(p_game text, p_board text, p_limit int default 10)` → filas `(pos int, name text, avatar text, time_ms int, rank text, created_at timestamptz, is_me boolean)`;
  - RPC `get_my_game_scores(p_game text) returns jsonb` → `{boards:{<board>:{time_ms,rank,pos}}, history:[{board,time_ms,rank,stats,created_at}]}`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Marcadores online (Fase 3)
alter table public.games add column if not exists boards jsonb not null default '[]'::jsonb;

update public.games
   set boards = '[{"id":"facil","label":"Fácil","min_s":600,"max_s":36000},{"id":"normal","label":"Normal","min_s":600,"max_s":36000},{"id":"clasico","label":"Clásico","min_s":600,"max_s":36000}]'::jsonb
 where slug = 'lima-infecta' and boards = '[]'::jsonb;

create table if not exists public.game_scores (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  game_slug  text not null references public.games(slug) on delete cascade,
  board      text not null,
  time_ms    int  not null check (time_ms > 0),
  rank       text not null check (rank in ('S', 'A', 'B', 'C')),
  stats      jsonb not null default '{}'::jsonb check (octet_length(stats::text) <= 2048),
  created_at timestamptz not null default now()
);

create index if not exists game_scores_board_idx on public.game_scores (game_slug, board, time_ms);
create index if not exists game_scores_user_idx  on public.game_scores (user_id, game_slug, created_at desc);

alter table public.game_scores enable row level security;
drop policy if exists "game_scores_public_read" on public.game_scores;
create policy "game_scores_public_read" on public.game_scores for select using (true);
-- Sin políticas de escritura: solo entra por submit_game_score (security definer).
revoke insert, update, delete on public.game_scores from anon, authenticated;

create or replace function public.submit_game_score(
  p_game text, p_board text, p_time_ms int, p_rank text, p_stats jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_boards jsonb;
  v_b      jsonb;
  v_pos    int;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select boards into v_boards from public.games where slug = p_game and status = 'published';
  if v_boards is null then
    raise exception 'game_not_found';
  end if;

  select e.value into v_b from jsonb_array_elements(v_boards) as e(value) where e.value->>'id' = p_board limit 1;
  if v_b is null then
    raise exception 'bad_board';
  end if;

  if p_time_ms is null
     or p_time_ms < (v_b->>'min_s')::int * 1000
     or p_time_ms > (v_b->>'max_s')::int * 1000 then
    raise exception 'time_out_of_range';
  end if;

  if p_rank is null or p_rank not in ('S', 'A', 'B', 'C') then
    raise exception 'bad_rank';
  end if;

  if p_stats is null then
    p_stats := '{}'::jsonb;
  end if;
  if jsonb_typeof(p_stats) <> 'object' or octet_length(p_stats::text) > 2048 then
    raise exception 'bad_stats';
  end if;

  insert into public.game_scores (user_id, game_slug, board, time_ms, rank, stats)
  values (v_uid, p_game, p_board, p_time_ms, p_rank, p_stats);

  with best as (
    select distinct on (s.user_id) s.user_id, s.time_ms, s.created_at
      from public.game_scores s
     where s.game_slug = p_game and s.board = p_board
     order by s.user_id, s.time_ms asc, s.created_at asc
  ), ranked as (
    select b.user_id, row_number() over (order by b.time_ms asc, b.created_at asc)::int as pos from best b
  )
  select r.pos into v_pos from ranked r where r.user_id = v_uid;

  return jsonb_build_object('status', 'published', 'pos', v_pos);
end;
$$;

create or replace function public.get_game_leaderboard(p_game text, p_board text, p_limit int default 10)
returns table (pos int, name text, avatar text, time_ms int, rank text, created_at timestamptz, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  with best as (
    select distinct on (s.user_id) s.user_id, s.time_ms, s.rank, s.created_at
      from public.game_scores s
     where s.game_slug = p_game and s.board = p_board
     order by s.user_id, s.time_ms asc, s.created_at asc
  ), ranked as (
    select b.*, row_number() over (order by b.time_ms asc, b.created_at asc)::int as pos from best b
  )
  select r.pos,
         coalesce(p.display_name, 'Jugador'),
         p.avatar_url,
         r.time_ms,
         r.rank,
         r.created_at,
         coalesce(r.user_id = auth.uid(), false)
    from ranked r
    left join public.profiles p on p.id = r.user_id
   order by r.pos
   limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

create or replace function public.get_my_game_scores(p_game text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_boards jsonb := '{}'::jsonb;
  v_hist   jsonb;
  r        record;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  for r in
    with best as (
      select distinct on (s.board, s.user_id) s.board, s.user_id, s.time_ms, s.rank, s.created_at
        from public.game_scores s
       where s.game_slug = p_game
       order by s.board, s.user_id, s.time_ms asc, s.created_at asc
    ), ranked as (
      select b.*, row_number() over (partition by b.board order by b.time_ms asc, b.created_at asc)::int as pos
        from best b
    )
    select x.board, x.time_ms, x.rank, x.pos from ranked x where x.user_id = v_uid
  loop
    v_boards := v_boards || jsonb_build_object(r.board, jsonb_build_object('time_ms', r.time_ms, 'rank', r.rank, 'pos', r.pos));
  end loop;

  select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc), '[]'::jsonb) into v_hist
    from (
      select s.board, s.time_ms, s.rank, s.stats, s.created_at
        from public.game_scores s
       where s.game_slug = p_game and s.user_id = v_uid
       order by s.created_at desc
       limit 10
    ) h;

  return jsonb_build_object('boards', v_boards, 'history', v_hist);
end;
$$;

revoke all on function public.submit_game_score(text, text, int, text, jsonb) from public, anon;
grant execute on function public.submit_game_score(text, text, int, text, jsonb) to authenticated;
revoke all on function public.get_game_leaderboard(text, text, int) from public;
grant execute on function public.get_game_leaderboard(text, text, int) to anon, authenticated;
revoke all on function public.get_my_game_scores(text) from public, anon;
grant execute on function public.get_my_game_scores(text) to authenticated;
```

- [ ] **Step 2: Revisar** que los `$$` estén balanceados, que cada sentencia termine en `;`, y que las columnas coincidan con el spec. No ejecutar nada.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261003140000_game_scores.sql
git commit -m "feat(games): migración de marcadores (game_scores + RPCs)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tipos y lógica pura de marcadores

**Files:**
- Modify: `src/features/games/types.ts`
- Create: `src/features/games/lib/scores.ts`
- Create: `src/features/games/lib/scores.test.ts`

**Interfaces:**
- Produces:
  - `interface GameBoard { id: string; label: string; min_s: number; max_s: number }`
  - `Game.boards: GameBoard[]`
  - `interface ScoreRow { pos: number; name: string; avatar: string | null; time_ms: number; rank: string; created_at: string; is_me: boolean }`
  - `interface MyScores { boards: Record<string, { time_ms: number; rank: string; pos: number }>; history: { board: string; time_ms: number; rank: string; stats: Record<string, unknown>; created_at: string }[] }`
  - `interface ScoreSubmission { board: string; time_ms: number; rank: string; stats: Record<string, unknown> }`
  - `formatTime(ms: number): string`
  - `pendingKey(slug: string): string`
  - `MAX_PENDING = 5`
  - `isSubmission(x: unknown): x is ScoreSubmission`
  - `addPending(list: unknown, item: ScoreSubmission, max?: number): ScoreSubmission[]`
  - `BOARD_RE = /^[a-z0-9_-]{1,32}$/`

- [ ] **Step 1: Test que falla.** Crear `src/features/games/lib/scores.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatTime, pendingKey, isSubmission, addPending, MAX_PENDING } from './scores';

const sub = (t: number) => ({ board: 'normal', time_ms: t, rank: 'A', stats: {} });

describe('formatTime', () => {
  it('m:ss por debajo de una hora', () => { expect(formatTime(65_000)).toBe('1:05'); });
  it('h:mm:ss desde una hora', () => { expect(formatTime(3_725_999)).toBe('1:02:05'); });
  it('valores inválidos', () => { expect(formatTime(Number.NaN)).toBe('—'); expect(formatTime(-1)).toBe('—'); });
});

describe('pendientes', () => {
  it('clave por juego', () => { expect(pendingKey('lima-infecta')).toBe('tl_pending_scores:lima-infecta'); });
  it('isSubmission valida forma', () => {
    expect(isSubmission(sub(700_000))).toBe(true);
    expect(isSubmission({ ...sub(1), board: 'NO VALE' })).toBe(false);
    expect(isSubmission({ ...sub(1), time_ms: '5' })).toBe(false);
    expect(isSubmission({ ...sub(1), rank: 'Z' })).toBe(false);
    expect(isSubmission({ ...sub(1), stats: [] })).toBe(false);
    expect(isSubmission(null)).toBe(false);
  });
  it('addPending descarta basura y conserva los últimos MAX_PENDING', () => {
    let list: unknown = 'basura';
    for (let i = 1; i <= 7; i++) list = addPending(list, sub(i * 1000));
    const out = list as ReturnType<typeof addPending>;
    expect(out).toHaveLength(MAX_PENDING);
    expect(out[0].time_ms).toBe(3000);
    expect(out[4].time_ms).toBe(7000);
  });
});
```

- [ ] **Step 2:** `pnpm test` → FAIL (no existe `./scores`).

- [ ] **Step 3: Implementar.** En `src/features/games/types.ts` añadir `boards: GameBoard[];` a `Game` (después de `save_exclude`) y al final:

```ts
export interface GameBoard { id: string; label: string; min_s: number; max_s: number }

export interface ScoreRow {
  pos: number; name: string; avatar: string | null; time_ms: number; rank: string; created_at: string; is_me: boolean;
}

export interface MyScores {
  boards: Record<string, { time_ms: number; rank: string; pos: number }>;
  history: { board: string; time_ms: number; rank: string; stats: Record<string, unknown>; created_at: string }[];
}

export interface ScoreSubmission { board: string; time_ms: number; rank: string; stats: Record<string, unknown> }
```

Crear `src/features/games/lib/scores.ts`:

```ts
import type { ScoreSubmission } from '../types';

export const BOARD_RE = /^[a-z0-9_-]{1,32}$/;
export const MAX_PENDING = 5;
const RANKS = ['S', 'A', 'B', 'C'];

export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export const pendingKey = (slug: string) => `tl_pending_scores:${slug}`;

export function isSubmission(x: unknown): x is ScoreSubmission {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.board === 'string' && BOARD_RE.test(o.board)
    && typeof o.time_ms === 'number' && Number.isFinite(o.time_ms) && o.time_ms > 0
    && typeof o.rank === 'string' && RANKS.includes(o.rank)
    && !!o.stats && typeof o.stats === 'object' && !Array.isArray(o.stats);
}

/** Añade una marca pendiente; descarta entradas inválidas y conserva las `max` más recientes. */
export function addPending(list: unknown, item: ScoreSubmission, max: number = MAX_PENDING): ScoreSubmission[] {
  const valid = Array.isArray(list) ? list.filter(isSubmission) : [];
  return [...valid, item].slice(-max);
}
```

- [ ] **Step 4:** `pnpm test` → PASS; filtro de astro check → `exit=1`.
- [ ] **Step 5: Commit** con `src/features/games/types.ts`, `src/features/games/lib/scores.ts` y `src/features/games/lib/scores.test.ts` (mensaje: `feat(games): tipos y lógica pura de marcadores`).

---

### Task 3: Peticiones del juego (`scoreRequests.ts`)

**Files:**
- Create: `src/features/games/lib/scoreRequests.ts`
- Create: `src/features/games/lib/scoreRequests.test.ts`

**Interfaces:**
- Consumes: `isSubmission`, `addPending`, `BOARD_RE` (Task 2).
- Produces:
  - `interface RequestDeps { slug: string; preview: boolean; getToken(): Promise<string | null>; fetch: typeof fetch; loadPending(): unknown; savePending(list: ScoreSubmission[]): void }`
  - `type RequestResult = { ok: true; data: unknown } | { ok: false; error: string }`
  - `handleGameRequest(name: unknown, params: unknown, deps: RequestDeps): Promise<RequestResult>`
  - `flushPending(deps: RequestDeps): Promise<void>`

- [ ] **Step 1: Test que falla.** Crear `src/features/games/lib/scoreRequests.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleGameRequest, flushPending, type RequestDeps } from './scoreRequests';

function deps(over: Partial<RequestDeps> = {}, responses: Array<[number, unknown]> = []) {
  let store: unknown = [];
  const calls: Array<[string, RequestInit | undefined]> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    const [status, body] = responses.shift() ?? [200, {}];
    return new Response(JSON.stringify(body), { status });
  });
  const d: RequestDeps = {
    slug: 'lima-infecta', preview: false,
    getToken: async () => 'tok',
    fetch: fetchMock as unknown as typeof fetch,
    loadPending: () => store,
    savePending: (l) => { store = l; },
    ...over,
  };
  return { d, calls, get store() { return store; } };
}
const sub = { board: 'normal', time_ms: 700_000, rank: 'A', stats: { kills: 3 } };

describe('handleGameRequest', () => {
  it('leaderboard: pide el top y quita campos privados', async () => {
    const t = deps({}, [[200, { rows: [{ pos: 1, name: 'Lag', avatar: 'x', time_ms: 700000, rank: 'A', created_at: 'c', is_me: true }] }]]);
    const r = await handleGameRequest('leaderboard', { board: 'normal' }, t.d);
    expect(r).toEqual({ ok: true, data: { rows: [{ pos: 1, name: 'Lag', time_ms: 700000, rank: 'A', me: true }] } });
    expect(t.calls[0][0]).toBe('/api/games/scores?game=lima-infecta&board=normal');
  });
  it('bad_params sin llamar a la API', async () => {
    const t = deps();
    expect(await handleGameRequest('leaderboard', { board: '../x' }, t.d)).toEqual({ ok: false, error: 'bad_params' });
    expect(await handleGameRequest('submitScore', { ...sub, time_ms: 'x' }, t.d)).toEqual({ ok: false, error: 'bad_params' });
    expect(t.calls).toHaveLength(0);
  });
  it('unknown_request', async () => {
    expect(await handleGameRequest('borrarTodo', {}, deps().d)).toEqual({ ok: false, error: 'unknown_request' });
  });
  it('myScores sin sesión → login', async () => {
    expect(await handleGameRequest('myScores', null, deps({ getToken: async () => null }).d)).toEqual({ ok: true, data: { login: true } });
  });
  it('submitScore publicado', async () => {
    const t = deps({}, [[200, { status: 'published', pos: 3 }]]);
    expect(await handleGameRequest('submitScore', sub, t.d)).toEqual({ ok: true, data: { status: 'published', pos: 3 } });
    expect(t.calls[0][1]?.method).toBe('POST');
  });
  it('submitScore sin sesión → pendiente', async () => {
    const t = deps({ getToken: async () => null });
    expect(await handleGameRequest('submitScore', sub, t.d)).toEqual({ ok: true, data: { status: 'pending_login' } });
    expect(t.store).toEqual([sub]);
  });
  it('submitScore rechazado por la API (400)', async () => {
    const t = deps({}, [[400, { error: 'time_out_of_range' }]]);
    expect(await handleGameRequest('submitScore', sub, t.d)).toEqual({ ok: true, data: { status: 'rejected', reason: 'time_out_of_range' } });
  });
  it('submitScore con error de red → queda pendiente y devuelve error', async () => {
    const t = deps({ fetch: (async () => { throw new TypeError('net'); }) as unknown as typeof fetch });
    expect(await handleGameRequest('submitScore', sub, t.d)).toEqual({ ok: false, error: 'offline' });
    expect(t.store).toEqual([sub]);
  });
  it('preview no publica', async () => {
    const t = deps({ preview: true });
    expect(await handleGameRequest('submitScore', sub, t.d)).toEqual({ ok: true, data: { status: 'rejected', reason: 'preview' } });
    expect(t.calls).toHaveLength(0);
  });
});

describe('flushPending', () => {
  it('publica pendientes; quita 2xx y 400, conserva 5xx', async () => {
    const a = { ...sub, time_ms: 600_000 }, b = { ...sub, time_ms: 650_000 }, c = { ...sub, time_ms: 660_000 };
    const t = deps({}, [[200, {}], [400, {}], [500, {}]]);
    t.d.savePending([a, b, c]);
    await flushPending(t.d);
    expect(t.store).toEqual([c]);
  });
  it('sin sesión no hace nada', async () => {
    const t = deps({ getToken: async () => null });
    t.d.savePending([sub]);
    await flushPending(t.d);
    expect(t.calls).toHaveLength(0);
    expect(t.store).toEqual([sub]);
  });
});
```

- [ ] **Step 2:** `pnpm test` → FAIL.

- [ ] **Step 3: Implementar.** Crear `src/features/games/lib/scoreRequests.ts`:

```ts
import type { ScoreSubmission } from '../types';
import { BOARD_RE, addPending, isSubmission } from './scores';

export interface RequestDeps {
  slug: string;
  preview: boolean;
  getToken(): Promise<string | null>;
  fetch: typeof fetch;
  loadPending(): unknown;
  savePending(list: ScoreSubmission[]): void;
}

export type RequestResult = { ok: true; data: unknown } | { ok: false; error: string };

const ok = (data: unknown): RequestResult => ({ ok: true, data });
const fail = (error: string): RequestResult => ({ ok: false, error });
const auth = (token: string | null): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

async function postScore(deps: RequestDeps, token: string, item: ScoreSubmission): Promise<Response> {
  return deps.fetch('/api/games/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ game: deps.slug, ...item }),
  });
}

/** Atiende un TL.request del juego. Nunca lanza: devuelve { ok, data | error }. */
export async function handleGameRequest(name: unknown, params: unknown, deps: RequestDeps): Promise<RequestResult> {
  const slug = encodeURIComponent(deps.slug);
  try {
    switch (name) {
      case 'leaderboard': {
        const board = (params as { board?: unknown } | null)?.board;
        if (typeof board !== 'string' || !BOARD_RE.test(board)) return fail('bad_params');
        const token = await deps.getToken();
        const res = await deps.fetch(`/api/games/scores?game=${slug}&board=${board}`, { headers: auth(token) });
        if (!res.ok) return fail(`http_${res.status}`);
        const body = (await res.json()) as { rows?: Array<Record<string, unknown>> };
        const rows = (body.rows ?? []).map((r) => ({
          pos: r.pos, name: r.name, time_ms: r.time_ms, rank: r.rank, me: r.is_me === true,
        }));
        return ok({ rows });
      }
      case 'myScores': {
        const token = await deps.getToken();
        if (!token) return ok({ login: true });
        const res = await deps.fetch(`/api/games/scores/me?game=${slug}`, { headers: auth(token) });
        if (res.status === 401) return ok({ login: true });
        if (!res.ok) return fail(`http_${res.status}`);
        return ok(await res.json());
      }
      case 'submitScore': {
        if (!isSubmission(params)) return fail('bad_params');
        const item: ScoreSubmission = { board: params.board, time_ms: Math.round(params.time_ms), rank: params.rank, stats: params.stats };
        if (deps.preview) return ok({ status: 'rejected', reason: 'preview' });
        const token = await deps.getToken();
        if (!token) {
          deps.savePending(addPending(deps.loadPending(), item));
          return ok({ status: 'pending_login' });
        }
        let res: Response;
        try {
          res = await postScore(deps, token, item);
        } catch {
          deps.savePending(addPending(deps.loadPending(), item));
          return fail('offline');
        }
        const body = (await res.json().catch(() => ({}))) as { pos?: number; error?: string };
        if (res.ok) return ok({ status: 'published', pos: body.pos ?? null });
        if (res.status === 400 || res.status === 404) return ok({ status: 'rejected', reason: body.error ?? 'rejected' });
        deps.savePending(addPending(deps.loadPending(), item));
        return fail(`http_${res.status}`);
      }
      default:
        return fail('unknown_request');
    }
  } catch {
    return fail('offline');
  }
}

/** Publica las marcas pendientes. Quita las aceptadas (2xx) y las inválidas (400/404); conserva el resto. */
export async function flushPending(deps: RequestDeps): Promise<void> {
  if (deps.preview) return;
  const token = await deps.getToken();
  if (!token) return;
  const list = Array.isArray(deps.loadPending()) ? (deps.loadPending() as unknown[]).filter(isSubmission) : [];
  if (!list.length) return;
  const remaining: ScoreSubmission[] = [];
  for (const item of list) {
    try {
      const res = await postScore(deps, token, item);
      if (!(res.ok || res.status === 400 || res.status === 404)) remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }
  deps.savePending(remaining);
}
```

- [ ] **Step 4:** `pnpm test` → PASS; filtro de astro check → `exit=1`.
- [ ] **Step 5: Commit** con ambos archivos (mensaje: `feat(games): peticiones de marcadores desde el juego`).

---

### Task 4: `TL.request` en el conector

**Files:**
- Modify: `public/g/_tl/connect.js`
- Modify: `tests/connector.test.ts`
- Modify: `public/g/README.md`

**Interfaces:**
- Produces:
  - `TL.request(name: string, params?: object): Promise<any>`, que rechaza con `Error('offline' | 'timeout' | <error de la web>)`.
  - Mensaje juego → web: `{tl:1, type:'request', game, id:number, name, params}`.
  - Mensaje web → juego: `{tl:1, type:'response', id, ok:boolean, data?, error?}`.

- [ ] **Step 1: Tests que fallan.** Añadir al final del `describe('connector', …)` de `tests/connector.test.ts` (usa los helpers `setup`, `SITE`, `vi` y `clock` que ya existen):

```ts
  it('request: envía y resuelve con la respuesta del padre', async () => {
    const { c, init, parent } = setup();
    init({});
    const p = c.request('leaderboard', { board: 'normal' });
    await Promise.resolve(); await Promise.resolve();
    const msg = parent.postMessage.mock.calls.map((a: any[]) => a[0]).find((m: any) => m.type === 'request');
    expect(msg).toMatchObject({ tl: 1, type: 'request', name: 'leaderboard', params: { board: 'normal' } });
    c._onMessage({ origin: SITE, source: parent, data: { tl: 1, type: 'response', id: msg.id, ok: true, data: { rows: [] } } });
    await expect(p).resolves.toEqual({ rows: [] });
  });

  it('request: respuesta con ok:false rechaza con el error', async () => {
    const { c, init, parent } = setup();
    init({});
    const p = c.request('borrarTodo');
    await Promise.resolve(); await Promise.resolve();
    const msg = parent.postMessage.mock.calls.map((a: any[]) => a[0]).find((m: any) => m.type === 'request');
    c._onMessage({ origin: SITE, source: parent, data: { tl: 1, type: 'response', id: msg.id, ok: false, error: 'unknown_request' } });
    await expect(p).rejects.toThrow('unknown_request');
  });

  it('request: ignora respuestas de otro origen, otra ventana o id desconocido y vence a los 8 s', async () => {
    const { c, init, parent } = setup();
    init({});
    const p = c.request('myScores');
    const caught = p.catch((e: Error) => e.message);
    await Promise.resolve(); await Promise.resolve();
    const msg = parent.postMessage.mock.calls.map((a: any[]) => a[0]).find((m: any) => m.type === 'request');
    c._onMessage({ origin: 'https://evil.example', source: parent, data: { tl: 1, type: 'response', id: msg.id, ok: true, data: 1 } });
    c._onMessage({ origin: SITE, source: {}, data: { tl: 1, type: 'response', id: msg.id, ok: true, data: 2 } });
    c._onMessage({ origin: SITE, source: parent, data: { tl: 1, type: 'response', id: 999, ok: true, data: 3 } });
    await vi.advanceTimersByTimeAsync(8000);
    await expect(caught).resolves.toBe('timeout');
  });

  it('request: sin init rechaza con offline al vencer ready', async () => {
    const { c } = setup();
    const caught = c.request('leaderboard', { board: 'normal' }).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(8000);
    await expect(caught).resolves.toBe('offline');
  });
```

- [ ] **Step 2:** `pnpm test` → los 4 tests nuevos FAIL (`c.request` no existe).

- [ ] **Step 3: Implementar** en `public/g/_tl/connect.js`:

1. Junto a las constantes de arriba: `var REQUEST_TIMEOUT = 8000;`
2. En las variables de `createConnector` (línea de `var parentOrigin = null, …`), añadir `, reqSeq = 0, pendingReq = {}`.
3. Dentro del objeto `api`, después de `exit`, añadir:

```js
      request: function (name, params) {
        return api.ready.then(function () {
          if (!parentOrigin) throw new Error('offline');
          return new Promise(function (resolve, reject) {
            var id = ++reqSeq;
            var timer = setT(function () { delete pendingReq[id]; reject(new Error('timeout')); }, REQUEST_TIMEOUT);
            pendingReq[id] = { resolve: resolve, reject: reject, timer: timer };
            post({ type: 'request', id: id, name: String(name), params: params == null ? null : params });
          });
        });
      },
```

4. En `onMessage`, justo después de la línea del `flush` (`if (d.type === 'flush') …`), añadir:

```js
      if (d.type === 'response') {
        if (e.origin !== parentOrigin) return;
        var pr = pendingReq[d.id];
        if (!pr) return;
        delete pendingReq[d.id];
        clearT(pr.timer);
        if (d.ok) pr.resolve(d.data); else pr.reject(new Error(String(d.error || 'error')));
        return;
      }
```

5. En el objeto `noop`, añadir `request: function () { return Promise.reject(new Error('offline')); }`.

En `public/g/README.md`, dentro de "Reglas para juegos nuevos", añadir el punto:

```md
7. Datos online (marcadores): `await TL.request('leaderboard', { board })`, `await TL.request('myScores')`, `await TL.request('submitScore', { board, time_ms, rank, stats })`. Rechaza con `offline`/`timeout` si no hay conexión: el juego debe seguir funcionando.
```

- [ ] **Step 4:** `pnpm test` → todo PASS.
- [ ] **Step 5: Commit** con los tres archivos (mensaje: `feat(games): TL.request en el conector`).

---

### Task 5: API de marcadores

**Files:**
- Create: `src/pages/api/games/scores.ts`
- Create: `src/pages/api/games/scores/me.ts`
- Create: `src/pages/api/admin/games/scores.ts`
- Modify: `src/pages/api/admin/games.ts` (añadir `'boards'` a `EDITABLE`)

**Interfaces:**
- Consumes: `createUserClient`, `createServiceClient`, `supabase` (`@/features/auth/lib/supabase`), `getCached` / `invalidateCache` (`@/shared/lib/cache`), `checkRateLimit` (`@/shared/lib/rateLimit`), `BOARD_RE` (Task 2), RPCs de la Task 1.
- Produces:
  - `GET /api/games/scores?game&board` → `{rows: ScoreRow[]}`
  - `POST /api/games/scores` → `{status, pos}` | 400 `{error}` | 401 | 404 | 429
  - `GET /api/games/scores/me?game` → `MyScores` | 401
  - `GET /api/admin/games/scores?game` → `{scores:[{id, board, time_ms, rank, created_at, name}]}`
  - `DELETE /api/admin/games/scores?id` → `{ok:true}`

- [ ] **Step 1: `src/pages/api/games/scores.ts`**

```ts
import type { APIRoute } from 'astro';
import { supabase, createUserClient } from '@/features/auth/lib/supabase';
import { getCached, invalidateCache } from '@/shared/lib/cache';
import { checkRateLimit } from '@/shared/lib/rateLimit';
import { BOARD_RE } from '@/features/games/lib/scores';

export const prerender = false;
const SLUG = /^[a-z0-9-]+$/;
const KNOWN_ERRORS: Record<string, number> = {
  time_out_of_range: 400, bad_board: 400, bad_rank: 400, bad_stats: 400, game_not_found: 404, not_authenticated: 401,
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function bearer(request: Request) {
  const h = request.headers.get('authorization');
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

export const GET: APIRoute = async ({ request, url }) => {
  const game = url.searchParams.get('game') ?? '';
  const board = url.searchParams.get('board') ?? '';
  if (!SLUG.test(game) || !BOARD_RE.test(board)) return json({ error: 'Datos inválidos' }, 400);

  const token = bearer(request);
  try {
    if (token) {
      // Con sesión no se cachea: is_me depende del usuario
      const { data, error } = await createUserClient(token).rpc('get_game_leaderboard', { p_game: game, p_board: board, p_limit: 10 });
      if (error) throw error;
      return json({ rows: data ?? [] });
    }
    const rows = await getCached({ key: `scores:${game}:${board}`, ttl: 60 }, async () => {
      const { data, error } = await supabase.rpc('get_game_leaderboard', { p_game: game, p_board: board, p_limit: 10 });
      if (error) throw error;
      return data ?? [];
    });
    return json({ rows });
  } catch (err) {
    console.error('[scores] leaderboard:', err);
    return json({ error: 'No se pudo cargar el marcador' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const token = bearer(request);
  if (!token) return json({ error: 'No autenticado' }, 401);
  const client = createUserClient(token);
  const { data: { user } } = await client.auth.getUser(token);
  if (!user) return json({ error: 'No autenticado' }, 401);
  if (!(await checkRateLimit('game-scores', 5, '1 m', user.id))) return json({ error: 'Demasiados envíos' }, 429);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Datos inválidos' }, 400);
  const { game, board, time_ms, rank, stats } = body;
  if (typeof game !== 'string' || !SLUG.test(game) || typeof board !== 'string' || !BOARD_RE.test(board)
      || typeof time_ms !== 'number' || !Number.isFinite(time_ms) || typeof rank !== 'string') {
    return json({ error: 'Datos inválidos' }, 400);
  }

  const { data, error } = await client.rpc('submit_game_score', {
    p_game: game, p_board: board, p_time_ms: Math.round(time_ms), p_rank: rank, p_stats: stats ?? {},
  });
  if (error) {
    const code = Object.keys(KNOWN_ERRORS).find((k) => error.message.includes(k));
    if (code) return json({ error: code }, KNOWN_ERRORS[code]);
    console.error('[scores] submit:', error);
    return json({ error: 'Error al publicar' }, 500);
  }
  await invalidateCache(`scores:${game}:${board}`);
  return json(data);
};
```

- [ ] **Step 2: `src/pages/api/games/scores/me.ts`**

```ts
import type { APIRoute } from 'astro';
import { createUserClient } from '@/features/auth/lib/supabase';

export const prerender = false;
const SLUG = /^[a-z0-9-]+$/;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request, url }) => {
  const h = request.headers.get('authorization');
  if (!h?.startsWith('Bearer ')) return json({ error: 'No autenticado' }, 401);
  const game = url.searchParams.get('game') ?? '';
  if (!SLUG.test(game)) return json({ error: 'Juego inválido' }, 400);

  const client = createUserClient(h.slice(7));
  const { data: { user } } = await client.auth.getUser(h.slice(7));
  if (!user) return json({ error: 'No autenticado' }, 401);

  const { data, error } = await client.rpc('get_my_game_scores', { p_game: game });
  if (error) {
    console.error('[scores] me:', error);
    return json({ error: 'No se pudieron cargar tus marcas' }, 500);
  }
  return json(data);
};
```

- [ ] **Step 3: `src/pages/api/admin/games/scores.ts`**

```ts
import type { APIRoute } from 'astro';
import { createServiceClient } from '@/features/auth/lib/supabase';
import { invalidateCache } from '@/shared/lib/cache';

export const prerender = false;
const SLUG = /^[a-z0-9-]+$/;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function requireAdmin(request: Request) {
  const h = request.headers.get('authorization');
  if (!h?.startsWith('Bearer ')) return null;
  const service = createServiceClient();
  const { data: { user } } = await service.auth.getUser(h.slice(7));
  if (!user) return null;
  const { data } = await service.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
  return data ? user : null;
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!(await requireAdmin(request))) return json({ error: 'No autorizado' }, 403);
  const game = url.searchParams.get('game') ?? '';
  if (!SLUG.test(game)) return json({ error: 'Juego inválido' }, 400);

  const service = createServiceClient();
  const { data, error } = await service
    .from('game_scores')
    .select('id, user_id, board, time_ms, rank, created_at')
    .eq('game_slug', game)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return json({ error: error.message }, 500);

  const ids = [...new Set((data ?? []).map((s) => s.user_id))];
  const { data: profiles } = ids.length
    ? await service.from('profiles').select('id, display_name').in('id', ids)
    : { data: [] as { id: string; display_name: string | null }[] };
  const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name ?? 'Jugador']));

  return json({
    scores: (data ?? []).map(({ user_id, ...s }) => ({ ...s, name: names.get(user_id) ?? 'Jugador' })),
  });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  if (!(await requireAdmin(request))) return json({ error: 'No autorizado' }, 403);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'id inválido' }, 400);

  const service = createServiceClient();
  const { data: row } = await service.from('game_scores').select('game_slug, board').eq('id', id).maybeSingle();
  if (!row) return json({ error: 'No existe' }, 404);
  const { error } = await service.from('game_scores').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);
  await invalidateCache(`scores:${row.game_slug}:${row.board}`);
  return json({ ok: true });
};
```

- [ ] **Step 4:** En `src/pages/api/admin/games.ts`, añadir `'boards'` al array `EDITABLE`.
- [ ] **Step 5:** Filtro de astro check → `exit=1`; `pnpm build` → `Complete!`.
- [ ] **Step 6: Commit** con los 4 archivos (mensaje: `feat(games): API de marcadores y moderación`).

---

### Task 6: Puente: atender `TL.request` y publicar pendientes

**Files:**
- Modify: `src/features/games/components/useGameBridge.ts`

**Interfaces:**
- Consumes: `handleGameRequest`, `flushPending`, `RequestDeps` (Task 3); `pendingKey` (Task 2).

- [ ] **Step 1: Implementar.** En `useGameBridge.ts`:

1. Imports nuevos:

```ts
import { handleGameRequest, flushPending, type RequestDeps } from '../lib/scoreRequests';
import { pendingKey } from '../lib/scores';
```

2. Dentro del `useEffect` que depende de `open`, justo después de `const initData = …`:

```ts
    const reqDeps: RequestDeps = {
      slug: game.slug,
      preview,
      getToken: accessToken,
      fetch: (...args) => window.fetch(...args),
      loadPending: () => { try { return JSON.parse(localStorage.getItem(pendingKey(game.slug)) || '[]'); } catch { return []; } },
      savePending: (list) => {
        try {
          if (list.length) localStorage.setItem(pendingKey(game.slug), JSON.stringify(list));
          else localStorage.removeItem(pendingKey(game.slug));
        } catch { /* almacenamiento no disponible */ }
      },
    };
    flushPending(reqDeps);
```

3. En `onMessage`, antes de `} else if (d.type === 'exit') {`, añadir:

```ts
      } else if (d.type === 'request' && typeof d.id === 'number') {
        const result = await handleGameRequest(d.name, d.params, reqDeps);
        if (!cancelled) reply({ type: 'response', id: d.id, ...result });
```

- [ ] **Step 2:** `pnpm test` → PASS; filtro de astro check → `exit=1`; `pnpm build` → `Complete!`.
- [ ] **Step 3: Commit** (mensaje: `feat(games): el reproductor atiende TL.request de marcadores`).

---

### Task 7: Marcadores en la web y moderación en el admin

**Files:**
- Create: `src/features/games/components/LeaderboardPanel.tsx`
- Modify: `src/pages/juegos/[slug].astro`
- Modify: `src/features/games/components/GamesManager.tsx`

**Interfaces:**
- Consumes: `GameBoard`, `ScoreRow`, `MyScores` (Task 2); `formatTime` (Task 2); API de la Task 5.
- Produces: `export function LeaderboardPanel(props: { slug: string; boards: GameBoard[] }): JSX.Element`.

- [ ] **Step 1: `LeaderboardPanel.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { supabase } from '@/features/auth/lib/supabase';
import { $currentUser } from '@/features/auth/stores/authStore';
import type { GameBoard, MyScores, ScoreRow } from '../types';
import { formatTime } from '../lib/scores';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export function LeaderboardPanel({ slug, boards }: { slug: string; boards: GameBoard[] }) {
  const user = useStore($currentUser);
  const [board, setBoard] = useState(boards.find((b) => b.id === 'normal')?.id ?? boards[0]?.id);
  const [rows, setRows] = useState<ScoreRow[] | null>(null);
  const [mine, setMine] = useState<MyScores | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!board) return;
    let alive = true;
    setRows(null); setError(false);
    (async () => {
      try {
        const res = await fetch(`/api/games/scores?game=${encodeURIComponent(slug)}&board=${board}`, { headers: await authHeaders() });
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        if (alive) setRows(body.rows ?? []);
      } catch { if (alive) setError(true); }
    })();
    return () => { alive = false; };
  }, [slug, board, user]);

  useEffect(() => {
    if (!user) { setMine(null); return; }
    let alive = true;
    (async () => {
      const res = await fetch(`/api/games/scores/me?game=${encodeURIComponent(slug)}`, { headers: await authHeaders() });
      if (res.ok && alive) setMine(await res.json());
    })().catch(() => {});
    return () => { alive = false; };
  }, [slug, user]);

  if (!boards.length) return null;
  const myBest = board ? mine?.boards?.[board] : undefined;

  return (
    <section className="mt-12">
      <h2 className="font-orbitron text-sm tracking-widest text-gray-500 mb-4">MARCADORES</h2>
      <div className="flex gap-2 mb-4">
        {boards.map((b) => (
          <button
            key={b.id}
            onClick={() => setBoard(b.id)}
            className={`px-4 py-1.5 rounded-full text-sm font-bold cursor-pointer border ${b.id === board ? 'bg-red-600 border-red-600 text-white' : 'border-white/15 text-gray-300 hover:bg-white/10'}`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {error && <p className="text-gray-500 text-sm">No se pudo cargar el marcador.</p>}
      {!error && rows === null && <p className="text-gray-500 text-sm">Cargando…</p>}
      {!error && rows?.length === 0 && <p className="text-gray-500 text-sm">Aún no hay marcas. ¡Sé el primero!</p>}
      {!error && rows && rows.length > 0 && (
        <ol className="divide-y divide-white/5 rounded-xl border border-white/10 overflow-hidden">
          {rows.map((r) => (
            <li key={r.pos} className={`flex items-center gap-3 px-4 py-2.5 ${r.is_me ? 'bg-red-600/15' : 'bg-white/[0.02]'}`}>
              <span className="w-8 font-orbitron text-gray-400">#{r.pos}</span>
              {r.avatar
                ? <img src={r.avatar} alt="" className="w-7 h-7 rounded-full object-cover" loading="lazy" />
                : <span className="w-7 h-7 rounded-full bg-white/10" />}
              <span className="flex-1 truncate text-white">{r.name}</span>
              <span className="font-mono text-white">{formatTime(r.time_ms)}</span>
              <span className="w-6 text-center font-bold text-yellow-400">{r.rank}</span>
            </li>
          ))}
        </ol>
      )}

      {user && myBest && !rows?.some((r) => r.is_me) && (
        <p className="mt-3 text-sm text-gray-300">Tu mejor: #{myBest.pos} · {formatTime(myBest.time_ms)} · {myBest.rank}</p>
      )}
      {!user && <p className="mt-3 text-sm text-gray-500"><a href="/login" className="text-white underline">Inicia sesión</a> para aparecer en el marcador.</p>}
    </section>
  );
}
```

- [ ] **Step 2: Montarlo** en `src/pages/juegos/[slug].astro`:
  - Importar `import { LeaderboardPanel } from '@/features/games/components/LeaderboardPanel';`.
  - Dentro de `<div class="md:col-span-2">`, después del párrafo de la descripción, añadir: `{game.boards?.length > 0 && <LeaderboardPanel client:only="react" slug={game.slug} boards={game.boards} />}`.

- [ ] **Step 3: Admin.** En `GamesManager.tsx`:
  - Añadir `boards: []` a `EMPTY`.
  - En el formulario, después del campo "Claves sin sincronizar", añadir el editor de tiempos:

```tsx
            <div className="md:col-span-2">
              <label className={lbl}>Marcadores (tiempo mínimo / máximo en segundos)</label>
              {(editing.boards ?? []).length === 0 && <p className="text-xs text-gray-500">Este juego no tiene marcadores.</p>}
              {(editing.boards ?? []).map((b, i) => (
                <div key={b.id} className="flex items-center gap-2 mb-2">
                  <span className="w-24 text-sm text-white">{b.label}</span>
                  <input type="number" min={1} className={input} value={b.min_s}
                    onChange={(e) => set({ boards: (editing.boards ?? []).map((x, j) => (j === i ? { ...x, min_s: Number(e.target.value) } : x)) })} />
                  <input type="number" min={1} className={input} value={b.max_s}
                    onChange={(e) => set({ boards: (editing.boards ?? []).map((x, j) => (j === i ? { ...x, max_s: Number(e.target.value) } : x)) })} />
                </div>
              ))}
            </div>
```

  - Añadir, fuera del formulario y debajo de la lista de juegos, un componente local `RecentScores`, que se muestra al pulsar un botón **Marcas** en cada fila de juego (`const [scoresFor, setScoresFor] = useState<string | null>(null);`). En la fila, junto a "Editar": `<button onClick={() => setScoresFor(scoresFor === g.slug ? null : g.slug)} className="px-3 py-1.5 text-xs border border-white/20 rounded cursor-pointer">Marcas</button>`. Debajo de la lista: `{scoresFor && <RecentScores slug={scoresFor} />}`.

```tsx
function RecentScores({ slug }: { slug: string }) {
  const [scores, setScores] = useState<{ id: number; name: string; board: string; time_ms: number; rank: string; created_at: string }[] | null>(null);

  async function load() {
    const res = await fetch(`/api/admin/games/scores?game=${encodeURIComponent(slug)}`, { headers: await authHeaders() });
    if (res.ok) setScores((await res.json()).scores);
  }
  useEffect(() => { load(); }, [slug]);

  async function remove(id: number) {
    if (!confirm('¿Borrar esta marca del marcador?')) return;
    const res = await fetch(`/api/admin/games/scores?id=${id}`, { method: 'DELETE', headers: await authHeaders() });
    if (res.ok) load();
  }

  if (!scores) return <p className="text-gray-500 text-sm">Cargando marcas…</p>;
  if (!scores.length) return <p className="text-gray-500 text-sm">Sin marcas todavía.</p>;
  return (
    <div className="p-4 rounded-xl border border-white/10 bg-black/40">
      <h3 className="font-orbitron text-white text-sm mb-3">Marcas recientes · {slug}</h3>
      <ul className="space-y-1">
        {scores.map((s) => (
          <li key={s.id} className="flex items-center gap-3 text-sm">
            <span className="flex-1 text-white truncate">{s.name}</span>
            <span className="text-gray-400">{s.board}</span>
            <span className="font-mono text-white">{formatTime(s.time_ms)}</span>
            <span className="text-yellow-400 w-4">{s.rank}</span>
            <span className="text-gray-500 text-xs">{new Date(s.created_at).toLocaleString('es')}</span>
            <button onClick={() => remove(s.id)} className="px-2 py-0.5 text-xs border border-red-500/40 text-red-400 rounded cursor-pointer">Borrar</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

  - Importar `formatTime` desde `../lib/scores`. `authHeaders` ya existe en el archivo.

- [ ] **Step 4:** Filtro de astro check → `exit=1`; `pnpm build` → `Complete!`.
- [ ] **Step 5: Commit** con los 3 archivos (mensaje: `feat(games): marcadores en la web y moderación en el admin`).

---

### Task 8 (C2 — tras recibir la versión mejorada de Lima): pantalla Marcadores en el juego

> Se ejecuta sobre el **código fuente de la versión mejorada** que entregue el usuario, no sobre `lima-infecta-src` actual. Los nombres de abajo (`TitleScene.opts`, `EndScene`, `SaveScene`, `T`/`TS`/`panel`/`hints`, `fmtTime`, `DIFF`, `S.G`, `DOC_COUNT`, `CLEAR_KEY`) corresponden a la versión actual: si cambiaron, adaptar conservando el comportamiento. Primero hay que **reaplicar las modificaciones del conector** de la fase 2: el `<script src="/g/_tl/connect.js" …>` en `src/template.html` y `if (window.TL) await window.TL.ready;` al inicio de `boot()`.

**Files (repo fuente de Lima):**
- Create: `src/ui/leaderboard.js`
- Modify: `src/ui/title.js`, `src/ui/end.js`, `src/main.js`, `src/template.html`
- Repo web: `public/g/lima-infecta/index.html` (build); subir `version` del juego.

- [ ] **Step 1: `src/main.js`**: `const DEBUG = false;` (sustituye la detección de `?debug`).

- [ ] **Step 2: `src/ui/leaderboard.js`**

```js
// Marcadores online (vía conector TeamLag): pestañas por dificultad y vistas Global / Tus marcas.
import { SC } from '../game/ctx.js';
import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { DIFF } from '../data/items.js';
import { T, TS, panel, hints, FU, FS } from './draw.js';
import { fmtTime } from '../core/util.js';

const BOARDS = ['facil', 'normal', 'clasico'];
const ms = v => fmtTime(Math.floor(v / 1000));
const req = (name, params) => (window.TL && window.TL.request ? window.TL.request(name, params) : Promise.reject(new Error('offline')));
const offline = e => e && (e.message === 'offline' || e.message === 'timeout');

export class LeaderboardScene {
  constructor(clear) {
    this.t = 0; this.modal = true; this.view = 0; this.cache = {}; this.mine = undefined; this.clear = clear || null;
    const i = BOARDS.indexOf(this.clear && this.clear.diff); this.b = i >= 0 ? i : 1;
    this.load();
  }
  key() { return BOARDS[this.b]; }
  load() {
    const k = this.key();
    if (!(k in this.cache)) { this.cache[k] = null; req('leaderboard', { board: k }).then(d => { this.cache[k] = d; }, e => { this.cache[k] = { error: e }; }); }
    if (this.mine === undefined) { this.mine = null; req('myScores').then(d => { this.mine = d; }, e => { this.mine = { error: e }; }); }
  }
  update(dt) {
    this.t += dt;
    if (Input.hit('left')) { this.b = (this.b + 2) % 3; Audio.sfx('ui'); this.load(); }
    if (Input.hit('right')) { this.b = (this.b + 1) % 3; Audio.sfx('ui'); this.load(); }
    if (Input.hit('up') || Input.hit('down')) { this.view = 1 - this.view; Audio.sfx('ui'); }
    if ((Input.hit('back') || Input.hit('ok')) && this.t > .15) { SC.remove(this); Audio.sfx('ui2'); }
  }
  localLine(k) {
    return this.clear && this.clear.diff === k ? `Tu mejor local: ${fmtTime(this.clear.time)} · Rango ${this.clear.rank}` : '';
  }
  draw(g) {
    g.fillStyle = 'rgba(4,4,6,.94)'; g.fillRect(0, 0, 1280, 720);
    TS(g, 'MARCADORES', 640, 84, 36, '#ece0c4', 'center', FS); g.fillStyle = '#a01818'; g.fillRect(500, 100, 280, 3);
    BOARDS.forEach((k, i) => { const sel = i === this.b; T(g, (DIFF[k] || { n: k }).n.toUpperCase(), 440 + i * 200, 150, sel ? 22 : 18, sel ? '#ffd070' : '#7a705c', 'center', FS); });
    T(g, this.view === 0 ? 'GLOBAL' : 'TUS MARCAS', 640, 186, 14, '#a89a80', 'center', FU);
    panel(g, 240, 204, 800, 420, .75, '#5a4a30');
    const k = this.key();
    if (this.view === 0) this.drawGlobal(g, k); else this.drawMine(g);
    hints(g, [['left', 'Dificultad'], ['up', 'Global / Tus marcas'], ['back', 'Volver']], 640, 676);
  }
  drawGlobal(g, k) {
    const d = this.cache[k];
    if (d === null || d === undefined) return T(g, 'Cargando…', 640, 420, 20, '#a89a80', 'center', FS);
    if (d.error) { T(g, offline(d.error) ? 'Sin conexión con TeamLag' : 'No se pudo cargar', 640, 400, 22, '#c8a050', 'center', FS); return T(g, this.localLine(k), 640, 440, 16, '#a89a80', 'center', FU); }
    if (!d.rows.length) return T(g, 'Aún no hay marcas. ¡Sé el primero!', 640, 420, 20, '#a89a80', 'center', FS);
    d.rows.forEach((r, i) => {
      const y = 250 + i * 36;
      if (r.me) { g.fillStyle = 'rgba(160,24,24,.35)'; g.fillRect(256, y - 24, 768, 32); }
      T(g, '#' + r.pos, 290, y, 18, '#c8bca0', 'left', FU);
      T(g, String(r.name).slice(0, 28), 360, y, 18, r.me ? '#ffe2a0' : '#ece4d0', 'left', FS);
      T(g, ms(r.time_ms), 930, y, 18, '#ffffff', 'right', FU);
      T(g, r.rank, 990, y, 18, '#ffd070', 'center', FS);
    });
    const best = this.mine && !this.mine.error && !this.mine.login && this.mine.boards && this.mine.boards[k];
    if (best && !d.rows.some(r => r.me)) T(g, `Tú: #${best.pos} · ${ms(best.time_ms)} · ${best.rank}`, 640, 612, 16, '#ffe2a0', 'center', FU);
  }
  drawMine(g) {
    const m = this.mine;
    if (m === null || m === undefined) return T(g, 'Cargando…', 640, 420, 20, '#a89a80', 'center', FS);
    if (m.error) { T(g, offline(m.error) ? 'Sin conexión con TeamLag' : 'No se pudo cargar', 640, 400, 22, '#c8a050', 'center', FS); return T(g, this.localLine(this.key()), 640, 440, 16, '#a89a80', 'center', FU); }
    if (m.login) return T(g, 'Inicia sesión en tlag.online para ver tus marcas', 640, 420, 20, '#c8a050', 'center', FS);
    BOARDS.forEach((k, i) => {
      const b = m.boards && m.boards[k], y = 250 + i * 34;
      T(g, (DIFF[k] || { n: k }).n, 290, y, 18, '#c8bca0', 'left', FS);
      T(g, b ? `#${b.pos} · ${ms(b.time_ms)} · ${b.rank}` : '—', 990, y, 18, '#ece4d0', 'right', FU);
    });
    g.fillStyle = 'rgba(232,220,192,.18)'; g.fillRect(256, 356, 768, 1);
    (m.history || []).slice(0, 7).forEach((h, i) => {
      const y = 388 + i * 32;
      T(g, new Date(h.created_at).toLocaleDateString('es'), 290, y, 15, '#8a7e68', 'left', FU);
      T(g, (DIFF[h.board] || { n: h.board }).n, 460, y, 15, '#a89a80', 'left', FU);
      T(g, ms(h.time_ms), 930, y, 15, '#ece4d0', 'right', FU);
      T(g, h.rank, 990, y, 15, '#ffd070', 'center', FS);
    });
  }
}
```

- [ ] **Step 3: `src/ui/title.js`**
  - Importar `import { LeaderboardScene } from './leaderboard.js';`.
  - Sustituir `get opts()` y el `switch` por entradas con id:

```js
  get opts() {
    const o = [['nueva', 'Nueva partida'], ['continuar', 'Continuar']];
    if (this.clear) o.push(['marcadores', 'Marcadores']);
    o.push(['opciones', 'Opciones'], ['controles', 'Controles'], ['ayuda', 'Cómo jugar']);
    return o;
  }
```

```js
    if (Input.hit('ok') && this.t - (this.pt || 0) > .2) {
      switch (this.opts[this.s][0]) {
        case 'nueva': Audio.sfx('ok'); return SC.push(new DiffScene(d => this.go(() => startNew(d))));
        case 'continuar': if (!this.hasSave) { Audio.sfx('deny'); return; } Audio.sfx('ok'); return SC.push(new SaveScene('load', data => this.go(() => loadState(data))));
        case 'marcadores': Audio.sfx('ok'); return SC.push(new LeaderboardScene(this.clear));
        case 'opciones': Audio.sfx('ok'); return SC.push(new OptionsScene());
        case 'controles': Audio.sfx('ok'); return SC.push(new ControlsScene());
        case 'ayuda': Audio.sfx('ok'); return SC.push(new HelpScene());
      }
    }
```

  - Al principio de `update` (tras `const n = this.opts.length;`), añadir `if (this.s >= n) this.s = n - 1;`.
  - En `draw`, el `forEach` pasa a `this.opts.forEach(([id, label], i) => { … dis = id === 'continuar' && !this.hasSave; … TS(g, label.toUpperCase(), …) })`.
  - Si hay 6 opciones, ajustar el espaciado vertical (`430 + i * 46` → `418 + i * 42`) para que no se solapen con las pistas de controles en y = 676.

- [ ] **Step 4: `src/ui/end.js`.** En el constructor, después de calcular `this.rank` y `acc`:

```js
    this.pub = null; this.diffName = (DIFF[G.diff] || DIFF.normal).n;
    if (window.TL && window.TL.request) {
      window.TL.request('submitScore', {
        board: G.diff, time_ms: Math.round(G.time * 1000), rank: this.rank,
        stats: { saves: G.saves, kills: G.kills, docs: G.files.length, docsTotal: DOC_COUNT, accuracy: G.shots ? Math.round(acc * 100) : null, heals: G.heals || 0 },
      }).then(r => { this.pub = r; }, () => {});
    }
```

  En `draw`, dentro del bloque `if (this.t > 3.2) { … }`, añadir:

```js
      if (this.pub && this.pub.status === 'published') T(g, `Tiempo publicado · #${this.pub.pos} en ${this.diffName}`, 1190, 640, 16, '#ffd070', 'right', FU);
      else if (this.pub && this.pub.status === 'pending_login') T(g, 'Inicia sesión en tlag.online para publicar tu tiempo', 1190, 640, 15, '#c8a050', 'right', FU);
```

- [ ] **Step 5: Build y verificación local**
  1. `mkdir -p dist && npm run build` en el repo fuente.
  2. Comprobar que el HTML contiene `g/_tl/connect.js`, `TL.ready`, `submitScore` y `LeaderboardScene` (o `MARCADORES`), y que **no** contiene `__TL`.
  3. Copiar a `tlag-page/public/g/lima-infecta/index.html`.
  4. Commit (`feat(games): Lima con marcadores online`).
  5. El controlador sube `version` de `lima-infecta` (admin o SQL).

- [ ] **Step 6: Prueba en el navegador** (controlador, `pnpm dev --host`):
  1. Completar el juego o simular, inyectando `tl_lima_clear` en el `localStorage` de `127.0.0.1`, y comprobar que el menú muestra Marcadores.
  2. Abrir Marcadores: las pestañas cargan, y sin sesión aparece el aviso de login en "Tus marcas".
  3. Con sesión, una marca publicada (`TL.request('submitScore', …)` desde la consola del iframe, como prueba) aparece en el juego y en `/juegos/lima-infecta`.
  4. "Probar" del admin no publica.
