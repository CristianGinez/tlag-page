-- Guardado en la nube de partidas (Fase 2)
create table if not exists public.game_saves (
  user_id    uuid not null references auth.users(id) on delete cascade,
  game_slug  text not null references public.games(slug) on delete cascade,
  key        text not null,
  value      text not null check (octet_length(value) <= 262144),
  prev_value text,
  client_at  timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, game_slug, key)
);

alter table public.game_saves enable row level security;

drop policy if exists "game_saves_select_own" on public.game_saves;
create policy "game_saves_select_own" on public.game_saves for select using (auth.uid() = user_id);
drop policy if exists "game_saves_insert_own" on public.game_saves;
create policy "game_saves_insert_own" on public.game_saves for insert with check (auth.uid() = user_id);
drop policy if exists "game_saves_update_own" on public.game_saves;
create policy "game_saves_update_own" on public.game_saves for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "game_saves_delete_own" on public.game_saves;
create policy "game_saves_delete_own" on public.game_saves for delete using (auth.uid() = user_id);

-- Escritura atómica: valida, respeta "gana el más reciente" y guarda la versión anterior.
create or replace function public.upsert_game_saves(p_game text, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_prefix   text;
  v_exclude  text[];
  v_item     jsonb;
  v_key      text;
  v_value    text;
  v_at       timestamptz;
  v_exists   boolean;
  v_count    int;
  v_rows     int;
  v_written  text[] := '{}';
  v_rejected text[] := '{}';
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select save_prefix, save_exclude into v_prefix, v_exclude
  from public.games where slug = p_game and status = 'published';
  if v_prefix is null or v_prefix = '' then
    raise exception 'game_not_saveable';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 20 then
    raise exception 'bad_items';
  end if;

  for v_item in select e from jsonb_array_elements(p_items) as t(e) loop
    v_key := v_item->>'key';
    v_value := v_item->>'value';
    begin
      v_at := to_timestamp((v_item->>'at')::double precision / 1000.0);
    exception when others then
      v_at := null;
    end;

    if v_key is null or v_value is null or v_at is null
       or left(v_key, length(v_prefix)) <> v_prefix
       or v_key = any(coalesce(v_exclude, '{}'))
       or octet_length(v_value) > 262144 then
      v_rejected := v_rejected || coalesce(v_key, '?');
      continue;
    end if;

    select exists (
      select 1 from public.game_saves where user_id = v_uid and game_slug = p_game and key = v_key
    ) into v_exists;
    if not v_exists then
      select count(*) into v_count from public.game_saves where user_id = v_uid and game_slug = p_game;
      if v_count >= 20 then
        v_rejected := v_rejected || v_key;
        continue;
      end if;
    end if;

    insert into public.game_saves as s (user_id, game_slug, key, value, client_at)
    values (v_uid, p_game, v_key, v_value, v_at)
    on conflict (user_id, game_slug, key) do update
      set prev_value = case when s.value is distinct from excluded.value then s.value else s.prev_value end,
          value      = excluded.value,
          client_at  = excluded.client_at,
          updated_at = now()
      where s.client_at < excluded.client_at;

    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      v_written := v_written || v_key;
    end if;
  end loop;

  return jsonb_build_object('written', to_jsonb(v_written), 'rejected', to_jsonb(v_rejected));
end;
$$;

-- Intercambia value <-> prev_value y marca la versión restaurada como la más reciente.
create or replace function public.restore_game_saves(p_game text)
returns int
language sql
security invoker
set search_path = public
as $$
  with r as (
    update public.game_saves
       set value = prev_value,
           prev_value = value,
           client_at = now(),
           updated_at = now()
     where user_id = auth.uid() and game_slug = p_game and prev_value is not null
    returning 1
  )
  select count(*)::int from r;
$$;

revoke all on function public.upsert_game_saves(text, jsonb) from public, anon;
grant execute on function public.upsert_game_saves(text, jsonb) to authenticated;
revoke all on function public.restore_game_saves(text) from public, anon;
grant execute on function public.restore_game_saves(text) to authenticated;
