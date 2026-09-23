import { useCallback, useEffect, useState } from 'react';

/**
 * Fullscreen where the browser supports it for the document. iPhone Safari does not, so the
 * control is hidden there rather than promised. A refused request is a quiet notice, not an error.
 */
export function useFullscreen(notify: (text: string) => void) {
  const [supported] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.fullscreenEnabled === true &&
      typeof document.documentElement.requestFullscreen === 'function',
  );
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!supported) return;
    const sync = () => setActive(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [supported]);
  const toggle = useCallback(() => {
    if (!supported) return;
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    request.catch(() => notify('Fullscreen is not available right now.'));
  }, [supported, notify]);
  return { supported, active, toggle };
}
