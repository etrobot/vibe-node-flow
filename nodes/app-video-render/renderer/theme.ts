// Pure color-theme utilities — NO Three.js / R3F dependency.
// Import from here in any render-path code that doesn't need 3D.

export function getThemeColors(hue?: number) {
  const h = hue ?? 0;

  if (h === 0 || h === 360) {
    return {
      blob1: '#6366f1',
      blob2: '#a855f7',
      blob3: '#4f46e5',
      pointLight1: '#c084fc',
      pointLight2: '#ff00ff',
      mountainWireframe: '#4f46e5',
      mountainLight1: '#4338ca',
      mountainLight2: '#8b5cf6',
      shockwave: '#a855f7',
      themePrimary: '#8b5cf6',
      themeSecondary: '#c084fc',
      themeAccent: '#06b6d4',
      themeGlow: 'rgba(168, 85, 247, 0.4)',
    };
  }

  if (h >= 320 && h <= 355) {
    // Forge brand: warm coral heart fading into pink → violet.
    return {
      blob1: '#ff5d7a',
      blob2: '#ff7a4d',
      blob3: '#a855f7',
      pointLight1: '#ff6b81',
      pointLight2: '#c05bff',
      mountainWireframe: '#ff5d7a',
      mountainLight1: '#e11d48',
      mountainLight2: '#a855f7',
      shockwave: '#ff5d7a',
      themePrimary: '#ff5d7a',
      themeSecondary: '#ff8a5c',
      themeAccent: '#b06bff',
      themeGlow: 'rgba(255, 93, 122, 0.42)',
    };
  }

  if (h >= 15 && h <= 80) {
    return {
      blob1: '#ea580c',
      blob2: '#f59e0b',
      blob3: '#fb923c',
      pointLight1: '#f97316',
      pointLight2: '#fbbf24',
      mountainWireframe: '#f97316',
      mountainLight1: '#c2410c',
      mountainLight2: '#f59e0b',
      shockwave: '#f97316',
      themePrimary: '#f97316',
      themeSecondary: '#f59e0b',
      themeAccent: '#fb923c',
      themeGlow: 'rgba(249, 115, 22, 0.4)',
    };
  }

  if (h >= 85 && h <= 145) {
    return {
      blob1: '#16a34a',
      blob2: '#10b981',
      blob3: '#84cc16',
      pointLight1: '#22c55e',
      pointLight2: '#84cc16',
      mountainWireframe: '#10b981',
      mountainLight1: '#15803d',
      mountainLight2: '#4ade80',
      shockwave: '#10b981',
      themePrimary: '#10b981',
      themeSecondary: '#84cc16',
      themeAccent: '#34d399',
      themeGlow: 'rgba(16, 185, 129, 0.4)',
    };
  }

  if (h >= 150 && h <= 205) {
    return {
      blob1: '#06b6d4',
      blob2: '#0ea5e9',
      blob3: '#14b8a6',
      pointLight1: '#22d3ee',
      pointLight2: '#38bdf8',
      mountainWireframe: '#06b6d4',
      mountainLight1: '#0891b2',
      mountainLight2: '#0ea5e9',
      shockwave: '#06b6d4',
      themePrimary: '#06b6d4',
      themeSecondary: '#38bdf8',
      themeAccent: '#22d3ee',
      themeGlow: 'rgba(6, 182, 212, 0.4)',
    };
  }

  return {
    blob1: '#2563eb',
    blob2: '#1d4ed8',
    blob3: '#6366f1',
    pointLight1: '#60a5fa',
    pointLight2: '#818cf8',
    mountainWireframe: '#2563eb',
    mountainLight1: '#1e40af',
    mountainLight2: '#4f46e5',
    shockwave: '#3b82f6',
    themePrimary: '#3b82f6',
    themeSecondary: '#6366f1',
    themeAccent: '#60a5fa',
    themeGlow: 'rgba(59, 130, 246, 0.4)',
  };
}

export function getTransitionBlobColors(hue?: number) {
  const h = hue ?? 0;

  if (h === 0 || h === 360) {
    return ['#6d28d9', '#7e22ce', '#5b21b6', '#4338ca', '#0e7490'];
  }

  if (h >= 320 && h <= 355) {
    return ['#b91c1c', '#be123c', '#991b1b', '#9f1239', '#c2410c'];
  }

  if (h >= 15 && h <= 80) {
    return ['#c2410c', '#b45309', '#d97706', '#a16207', '#b91c1c'];
  }

  if (h >= 85 && h <= 145) {
    return ['#047857', '#15803d', '#65a30d', '#0f766e', '#166534'];
  }

  if (h >= 150 && h <= 205) {
    return ['#0891b2', '#0e7490', '#0284c7', '#0f766e', '#155e75'];
  }

  return ['#1d4ed8', '#2563eb', '#3730a3', '#4338ca', '#0369a1'];
}
