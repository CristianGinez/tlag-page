import { useState } from 'react';
import type { TrackedStreamer, Platform } from '../types';
import { supabase } from '@/features/auth/lib/supabase';

const PLATFORM_COLOR: Record<Platform, string> = { twitch: '#9146FF', youtube: '#FF0000', kick: '#53FC18' };

interface Props {
  initialStreamers: TrackedStreamer[];
}

interface EditState {
  streamer: TrackedStreamer;
  displayName: string;
  accentColor: string;
  platformLogin: string;
}

export default function StreamersManager({ initialStreamers }: Props) {
  const [streamers, setStreamers] = useState(initialStreamers);
  const [platform, setPlatform] = useState<Platform>('twitch');
  const [login, setLogin] = useState('');
  const [channelId, setChannelId] = useState('');
  const [youtubeLogin, setYoutubeLogin] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function callApi(action: string, args: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/bot/streamers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ action, ...args }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      return data.result;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function refreshList() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/bot/streamers', {
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      const data = await res.json();
      if (data.ok) setStreamers(data.result || []);
    } catch (_) {}
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (platform === 'twitch' && !login) return setError('Falta el login de Twitch');
    if (platform === 'kick' && !login) return setError('Falta el usuario de Kick');
    if (platform === 'youtube' && !youtubeLogin) return setError('Falta el handle de YouTube');
    if (platform === 'youtube' && !channelId) return setError('Falta el Channel ID (UC...) de YouTube');

    const action = platform === 'twitch' ? 'addTwitch' : platform === 'kick' ? 'addKick' : 'addYoutube';
    const args: Record<string, string | undefined> = {
      displayName: displayName || undefined,
      accentColor: accentColor || undefined,
    };
    if (platform !== 'youtube') {
      args.login = login;
    } else {
      args.login = youtubeLogin;
      args.channelId = channelId;
    }

    try {
      await callApi(action, args);
      await refreshList();
      setLogin('');
      setChannelId('');
      setYoutubeLogin('');
      setDisplayName('');
      setAccentColor('');
    } catch (_) {}
  }

  async function handleToggle(streamerId: string, enabled: boolean) {
    try {
      await callApi('setEnabled', { streamerId, enabled: !enabled });
      setStreamers(prev => prev.map(s => s._id === streamerId ? { ...s, enabled: !enabled } : s));
    } catch (_) {}
  }

  async function handleDelete(streamerId: string) {
    if (!confirm('¿Borrar este streamer? Esto desuscribe el webhook.')) return;
    try {
      await callApi('remove', { streamerId });
      setStreamers(prev => prev.filter(s => s._id !== streamerId));
    } catch (_) {}
  }

  function openEdit(s: TrackedStreamer) {
    setEditState({ streamer: s, displayName: s.displayName || '', accentColor: s.accentColor || '', platformLogin: s.platformLogin || '' });
    setEditError(null);
  }

  function closeEdit() {
    setEditState(null);
    setEditError(null);
  }

  async function handleEditSave() {
    if (!editState) return;
    setEditLoading(true);
    setEditError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/bot/streamers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          action: 'update',
          streamerId: editState.streamer._id,
          displayName: editState.displayName || undefined,
          accentColor: editState.accentColor || undefined,
          platformLogin: editState.platformLogin || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      setStreamers(prev => prev.map(s =>
        s._id === editState.streamer._id
          ? { ...s, displayName: editState.displayName || undefined, accentColor: editState.accentColor || undefined, platformLogin: editState.platformLogin || s.platformLogin }
          : s
      ));
      closeEdit();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="p-6 rounded-2xl bg-white/5 border border-white/10">
        <h2 className="text-xl font-bold font-orbitron mb-4">Agregar streamer</h2>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-widest text-gray-500 mb-1">Plataforma</label>
            <select
              value={platform}
              onChange={e => setPlatform(e.target.value as Platform)}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2"
            >
              <option value="twitch">Twitch</option>
              <option value="youtube">YouTube</option>
              <option value="kick">Kick</option>
            </select>
          </div>

          {platform !== 'youtube' ? (
            <div>
              <label className="block text-xs uppercase tracking-widest text-gray-500 mb-1">
                {platform === 'kick' ? 'Usuario (kick.com/…)' : 'Login (usuario)'}
              </label>
              <input
                type="text"
                value={login}
                onChange={e => setLogin(e.target.value)}
                placeholder="lagartovich"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs uppercase tracking-widest text-gray-500 mb-1">Handle (usuario)</label>
                <input
                  type="text"
                  value={youtubeLogin}
                  onChange={e => setYoutubeLogin(e.target.value)}
                  placeholder="LAGartovich"
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest text-gray-500 mb-1">Channel ID (UC...)</label>
                <input
                  type="text"
                  value={channelId}
                  onChange={e => setChannelId(e.target.value)}
                  placeholder="UCabc123..."
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs uppercase tracking-widest text-gray-500 mb-1">Display name (opcional)</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="LAG"
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-widest text-gray-500 mb-1">Color hex (opcional)</label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={accentColor || '#dc2626'}
                onChange={e => setAccentColor(e.target.value)}
                className="h-10 w-10 rounded-lg cursor-pointer border border-white/10 bg-transparent p-0.5 shrink-0"
                title="Seleccionar color"
              />
              <input
                type="text"
                value={accentColor}
                onChange={e => setAccentColor(e.target.value)}
                placeholder="#dc2626"
                className="flex-1 bg-black/40 border border-white/10 rounded-lg px-4 py-2 font-mono text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="md:col-span-2 px-6 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg font-bold transition-colors"
          >
            {loading ? 'Procesando…' : 'Agregar streamer'}
          </button>
        </form>

        {error && (
          <div className="mt-4 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xl font-bold font-orbitron mb-4">Streamers ({streamers.length})</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {streamers.map(s => (
            <article
              key={s._id}
              className="p-4 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between gap-4"
              style={{
                borderLeftColor: s.accentColor || PLATFORM_COLOR[s.platform],
                borderLeftWidth: 4,
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={
                    s.profileImageUrl ||
                    (s.platform === 'kick'
                      ? undefined
                      : `https://unavatar.io/${s.platform}/${s.platformLogin}`)
                  }
                  alt={s.platformLogin}
                  className="w-10 h-10 rounded-full shrink-0 object-cover bg-white/10"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-widest text-gray-500">{s.platform}</p>
                  <p className="font-bold truncate">{s.displayName || s.platformLogin}</p>
                  <p className="text-xs text-gray-400">@{s.platformLogin}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleToggle(s._id, s.enabled)}
                  disabled={loading}
                  className={`px-3 py-1 rounded text-xs font-bold disabled:opacity-50 ${
                    s.enabled
                      ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                      : 'bg-gray-500/20 text-gray-400 hover:bg-gray-500/30'
                  }`}
                >
                  {s.enabled ? 'Activo' : 'Pausado'}
                </button>
                <button
                  onClick={() => openEdit(s)}
                  disabled={loading}
                  className="px-3 py-1 rounded text-xs font-bold bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50"
                >
                  Editar
                </button>
                <button
                  onClick={() => handleDelete(s._id)}
                  disabled={loading}
                  className="px-3 py-1 rounded text-xs font-bold bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50"
                >
                  Borrar
                </button>
              </div>
            </article>
          ))}

          {streamers.length === 0 && (
            <p className="text-gray-500 italic">No hay streamers configurados todavía.</p>
          )}
        </div>
      </section>

      {/* Modal de edición */}
      {editState && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) closeEdit(); }}
        >
          <div className="w-full max-w-md bg-[#0f0f0f] border border-white/10 rounded-2xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-gray-500">{editState.streamer.platform}</p>
                <h3 className="text-lg font-bold font-orbitron">Editar streamer</h3>
                <p className="text-sm text-gray-400">@{editState.streamer.platformLogin}</p>
              </div>
              <button onClick={closeEdit} className="text-gray-500 hover:text-white text-xl leading-none mt-1">✕</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-widest text-gray-500 mb-1">
                  {editState.streamer.platform === 'twitch'
                    ? 'Login (usuario Twitch)'
                    : editState.streamer.platform === 'kick'
                      ? 'Usuario (kick.com/…)'
                      : 'Channel ID (UC...)'}
                </label>
                <input
                  type="text"
                  value={editState.platformLogin}
                  onChange={e => setEditState(prev => prev ? { ...prev, platformLogin: e.target.value } : null)}
                  placeholder={editState.streamer.platformLogin}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest text-gray-500 mb-1">Display name</label>
                <input
                  type="text"
                  value={editState.displayName}
                  onChange={e => setEditState(prev => prev ? { ...prev, displayName: e.target.value } : null)}
                  placeholder={editState.streamer.platformLogin}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest text-gray-500 mb-1">Color hex</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={editState.accentColor || '#dc2626'}
                    onChange={e => setEditState(prev => prev ? { ...prev, accentColor: e.target.value } : null)}
                    className="h-10 w-10 rounded-lg cursor-pointer border border-white/10 bg-transparent p-0.5 shrink-0"
                  />
                  <input
                    type="text"
                    value={editState.accentColor}
                    onChange={e => setEditState(prev => prev ? { ...prev, accentColor: e.target.value } : null)}
                    placeholder="#dc2626"
                    className="flex-1 bg-black/40 border border-white/10 rounded-lg px-4 py-2 font-mono text-sm"
                  />
                </div>
              </div>
            </div>

            {editError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {editError}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={closeEdit}
                disabled={editLoading}
                className="flex-1 px-4 py-2 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/30 text-sm font-bold transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleEditSave}
                disabled={editLoading}
                className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-sm font-bold transition-colors disabled:opacity-50"
              >
                {editLoading ? 'Guardando…' : 'Confirmar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
