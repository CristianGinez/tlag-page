import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PlayerGame } from '../types';
import { getPlayUrl, getPlayOrigin } from '../lib/playUrl';
import { useGameBridge } from './useGameBridge';

interface Props {
  game: PlayerGame;
  /** true en el admin: no cuenta la partida. */
  preview?: boolean;
  label?: string;
}

const LOAD_TIMEOUT_MS = 20_000;
const FLUSH_GRACE_MS = 400; // margen para que el último guardado llegue al puente antes de desmontar

export function GamePlayer({ game, preview = false, label = 'JUGAR' }: Props) {
  const [open, setOpen] = useState(false);
  const [askRotate, setAskRotate] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const playUrl = getPlayUrl(game);

  const closeTimer = useRef<number | undefined>(undefined);

  function closeNow() {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setOpen(false);
    setAskRotate(false);
    setLoaded(false);
    setFailed(false);
  }

  /** Pide al conector que suba ya el guardado pendiente. */
  function requestFlush() {
    iframeRef.current?.contentWindow?.postMessage(
      { tl: 1, type: 'flush', game: game.slug },
      getPlayOrigin(game),
    );
  }

  /** Cierre normal: pide el flush y desmonta tras un breve margen (el puente sigue escuchando). */
  function close() {
    if (closeTimer.current !== undefined) return;
    requestFlush();
    closeTimer.current = window.setTimeout(closeNow, FLUSH_GRACE_MS);
  }

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const syncStatus = useGameBridge({ open, iframe: iframeRef, game, preview, onExit: close });

  function launch() {
    setAskRotate(false);
    setLoaded(false);
    setFailed(false);
    setOpen(true);
    if (!preview) {
      fetch('/api/games/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: game.slug }),
      }).catch(() => {});
    }
  }

  function onPlayClick() {
    const portraitTouch = window.matchMedia('(orientation: portrait) and (pointer: coarse)').matches;
    if (game.orientation === 'landscape' && portraitTouch) {
      setAskRotate(true);
      return;
    }
    launch();
  }

  // Si pidió girar y el teléfono ya está horizontal, arrancar solo
  useEffect(() => {
    if (!askRotate) return;
    const mq = window.matchMedia('(orientation: landscape)');
    const onChange = () => { if (mq.matches) launch(); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [askRotate]);

  // Mientras está abierto: modo juego, cerrar al navegar
  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add('tl-playing');
    const onSwap = () => { requestFlush(); closeNow(); };
    document.addEventListener('astro:before-swap', onSwap);
    return () => {
      document.documentElement.classList.remove('tl-playing');
      document.removeEventListener('astro:before-swap', onSwap);
    };
  }, [open]);

  // Tiempo máximo de carga
  useEffect(() => {
    if (!open || loaded) return;
    const t = window.setTimeout(() => setFailed(true), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [open, loaded, attempt]);

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else overlayRef.current?.requestFullscreen?.().catch(() => {});
  }

  const overlay = open ? (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[2147483000] bg-black"
      role="dialog"
      aria-label={game.title}
    >
      <iframe
        key={attempt}
        ref={iframeRef}
        data-tl-game={game.slug}
        src={playUrl}
        title={game.title}
        className="absolute inset-0 w-full h-full border-0"
        allow="fullscreen; gamepad; autoplay"
        sandbox="allow-scripts allow-same-origin allow-pointer-lock"
        onLoad={() => setLoaded(true)}
      />

      {!loaded && !failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black text-white pointer-events-none">
          {game.cover_url && (
            <img src={game.cover_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
          )}
          <div className="relative w-12 h-12 border-4 border-white/10 border-t-red-600 rounded-full animate-spin" />
          <p className="relative font-orbitron text-sm tracking-widest">CARGANDO</p>
        </div>
      )}

      {failed && !loaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 text-white">
          <p className="font-orbitron">No se pudo cargar el juego</p>
          <button
            className="px-6 py-2 bg-white text-black font-bold rounded-full cursor-pointer"
            onClick={() => { setFailed(false); setAttempt((a) => a + 1); }}
          >
            Reintentar
          </button>
        </div>
      )}

      {syncStatus !== 'idle' && (
        <div className="absolute bottom-3 left-3 px-3 py-1 rounded-full bg-black/70 text-white/80 text-xs pointer-events-none">
          {syncStatus === 'saved' && '☁ Guardado'}
          {syncStatus === 'offline' && 'Sin conexión · guardado local'}
          {syncStatus === 'login' && 'Inicia sesión para guardar en la nube'}
        </div>
      )}

      <div className="absolute top-2 right-2 flex gap-2">
        <button
          onClick={toggleFullscreen}
          className="w-9 h-9 rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/80 text-lg cursor-pointer"
          aria-label="Pantalla completa"
          title="Pantalla completa"
        >
          ⛶
        </button>
        <button
          onClick={close}
          className="w-9 h-9 rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/80 text-lg cursor-pointer"
          aria-label="Salir del juego"
          title="Salir"
        >
          ✕
        </button>
      </div>
    </div>
  ) : null;

  const rotate = askRotate ? (
    <div className="fixed inset-0 z-[2147483000] bg-black flex flex-col items-center justify-center gap-6 text-white text-center p-6">
      <div className="text-6xl animate-pulse">📱↻</div>
      <p className="font-orbitron">Gira tu teléfono para jugar</p>
      <div className="flex gap-3">
        <button className="px-5 py-2 border border-white/20 rounded-full cursor-pointer" onClick={() => setAskRotate(false)}>Cancelar</button>
        <button className="px-5 py-2 bg-white text-black font-bold rounded-full cursor-pointer" onClick={launch}>Jugar igual</button>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        onClick={onPlayClick}
        className="px-10 py-4 bg-red-600 hover:bg-red-500 text-white font-black font-orbitron text-xl tracking-widest rounded-full shadow-[0_0_30px_rgba(220,38,38,0.5)] transition-all hover:scale-105 cursor-pointer"
      >
        {label}
      </button>
      {typeof document !== 'undefined' && overlay && createPortal(overlay, document.body)}
      {typeof document !== 'undefined' && rotate && createPortal(rotate, document.body)}
    </>
  );
}
