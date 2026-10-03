-- Catálogo de juegos de TeamLag (Fase 1)
create table if not exists public.games (
  slug          text primary key check (slug ~ '^[a-z0-9-]+$'),
  title         text not null,
  tagline       text,
  description   text,
  cover_url     text,
  controls      text,
  tags          text[] not null default '{}',
  play_url      text,
  version       int not null default 1 check (version >= 1),
  orientation   text not null default 'any' check (orientation in ('any', 'landscape')),
  status        text not null default 'draft' check (status in ('draft', 'published', 'hidden')),
  display_order int not null default 99,
  published_at  timestamptz,
  plays         bigint not null default 0,
  save_prefix   text,
  save_exclude  text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.games enable row level security;

drop policy if exists "games_public_read" on public.games;
create policy "games_public_read" on public.games
  for select using (status = 'published');

-- Contador de partidas: cualquiera puede sumar 1 a un juego publicado (rate limit en la API).
create or replace function public.increment_game_plays(p_slug text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.games set plays = plays + 1 where slug = p_slug and status = 'published';
$$;

revoke all on function public.increment_game_plays(text) from public;
grant execute on function public.increment_game_plays(text) to anon, authenticated;

insert into public.games
  (slug, title, tagline, description, controls, tags, orientation, status, display_order, save_prefix, save_exclude)
values (
  'lima-infecta',
  'TEAMLAG: Lima Infecta',
  'Incidente Lupitox',
  'Survival horror 3D de cámaras fijas. Lima ha caído y Lag tiene que salir con vida.',
  'Teclado y ratón, mando o controles táctiles en el móvil.',
  '{terror,+13,pc-y-movil}',
  'landscape',
  'draft',
  1,
  'tl_lima_',
  '{tl_lima_settings}'
)
on conflict (slug) do nothing;
