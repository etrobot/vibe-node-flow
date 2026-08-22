import { useEffect, useState } from 'react';

export const MOBILE_MEDIA_QUERY = '(max-width: 639px)';

export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

export function useMobileViewport(): boolean {
  const [mobile, setMobile] = useState(isMobileViewport);
  useEffect(() => {
    const media = window.matchMedia(MOBILE_MEDIA_QUERY);
    const sync = () => setMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return mobile;
}
