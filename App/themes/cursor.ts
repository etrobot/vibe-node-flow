export const theme = {
  id: 'cursor',
  name: 'Cursor',
  colors: {
    primary: '#f54e00', primaryActive: '#d04200', primaryDisabled: '#fef0e8', black: '#000000', actionText: '#ffffff', ink: '#26251e',
    body: '#5a5852', bodyStrong: '#26251e', muted: '#807d72', mutedSoft: '#a09c92',
    hairline: '#e6e5e0', hairlineStrong: '#cfcdc4', canvas: '#f7f7f4', surfaceSoft: '#fafaf7',
    surfaceCard: '#ffffff', surfaceElevated: '#e6e5e0', surfaceYellowBand: '#fef0e8',
    onPrimary: '#ffffff', onDark: '#ffffff', onYellow: '#26251e', accentEmerald: '#1f8a65',
    accentRose: '#cf2d56', accentBlue: '#9fbbe0', success: '#1f8a65', warning: '#c08532', error: '#cf2d56',
  },
  typography: { sans: 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif', mono: 'JetBrains Mono, "SF Mono", "Fira Code", monospace' },
} as const;
export default theme;
