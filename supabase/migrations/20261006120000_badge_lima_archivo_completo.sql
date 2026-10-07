-- Logro de juego: "Archivo completo" (Lima Infecta). Lo otorga /api/games/achievement cuando el juego avisa
-- que la Multimedia está completa (todo visto y los cinco finales).
insert into public.badges (slug, name, description, criteria, icon, rarity, color, is_secret, is_active, display_order, ui)
values (
  'lima-archivo-completo',
  'Archivo completo',
  'Completaste la Multimedia de TEAMLAG: Lima Infecta.',
  'En Lima Infecta, desbloqueá toda la Multimedia: todo visto y los cinco finales.',
  '🗂️',
  'epic',
  '#c81818',
  false,
  true,
  9,
  '{"glow":"0 0 20px rgba(200,24,24,0.35), 0 0 50px rgba(200,24,24,0.12)","label":"Lima Infecta","pulse":true,"imgGlow":"rgba(200,24,24,0.8)","background":"linear-gradient(135deg, rgba(200,24,24,0.22), rgba(200,160,80,0.08), rgba(120,10,10,0.05))","labelColor":"rgb(232,176,128)","pulseColor":"rgba(200,24,24,1)","borderColor":"rgba(200,24,24,0.6)","shimmerColor":"rgba(232,176,128,0.7)","hoverBorderColor":"rgba(200,24,24,1)"}'::jsonb
)
on conflict (slug) do nothing;
