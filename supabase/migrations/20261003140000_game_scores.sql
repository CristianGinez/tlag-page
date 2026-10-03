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
-- Acceso solo vía SECURITY DEFINER RPCs (admin API usa service role).
revoke all on public.game_scores from anon, authenticated;

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
     or p_time_ms < coalesce((v_b->>'min_s')::int, 600) * 1000
     or p_time_ms > coalesce((v_b->>'max_s')::int, 36000) * 1000 then
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
