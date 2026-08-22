export const MOBILE_MEDIA_QUERY = '(max-width: 639px)';

export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}
