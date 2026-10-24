import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { EnginePlayer, audioSupported, setSoundPreference, soundPreference, type SoundDef } from './engineSound';

interface Live<P> {
  params: P;
  playing: boolean;
}

/**
 * Owns the engine sound of one viewer: off by default, created on the first click (autoplay
 * rules), silent while paused or while the tab is hidden.
 */
export function useEngineSound<P, I>(def: SoundDef<P, I> | undefined, instance: I | null, live: RefObject<Live<P>>) {
  const available = !!def && audioSupported();
  const [on, setOn] = useState(() => available && soundPreference());
  const player = useRef<EnginePlayer<P, I> | null>(null);

  const ensure = useCallback(() => {
    if (!def) return null;
    if (!player.current) player.current = new EnginePlayer(def);
    void player.current.resume();
    return player.current;
  }, [def]);

  const toggle = useCallback(() => {
    const next = !on;
    setSoundPreference(next);
    // Create/resume inside the click: browsers only allow audio to start from a user gesture.
    if (next) ensure();
    setOn(next);
  }, [on, ensure]);

  useEffect(() => {
    if (!on || !instance) return;
    const p = ensure();
    if (!p) return;
    let active: boolean | null = null,
      alive = true;
    const tick = () => {
      const l = live.current;
      if (!alive || !l) return;
      p.update(l.params, instance);
      const want = l.playing && !document.hidden;
      if (want !== active) {
        active = want;
        p.setActive(want);
        if (want) void p.resume();
      }
    };
    p.whenReady().then(tick, () => setOn(false));
    const id = setInterval(tick, 33);
    return () => {
      alive = false;
      clearInterval(id);
      p.setActive(false);
    };
  }, [on, instance, ensure, live]);

  useEffect(
    () => () => {
      player.current?.close();
      player.current = null;
    },
    [],
  );

  return { available, on, toggle };
}
