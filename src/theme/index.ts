// Day pond and night pond. Text colors are checked for at least 4.5:1 contrast.
import { useColorScheme } from 'react-native';

const light = {
  bg: '#FFF8E7',
  card: '#FFFFFF',
  cardEdge: '#F1E3C0',
  ink: '#33294A',
  inkSoft: '#5E5677',
  pond: '#A8DCEF',
  pondDeep: '#7FC6E4',
  pondLight: '#D3EEF8',
  reed: '#8CCB98',
  reedDark: '#6DB27C',
  primary: '#FFD54F',
  primaryEdge: '#E9B52E',
  onPrimary: '#33294A',
  secondary: '#D3EEF8',
  secondaryEdge: '#9CCFE3',
  onSecondary: '#1F4157',
  accentText: '#2F6E8C',
  ok: '#2E7D4F',
  warn: '#A1471C',
  sky: '#FFF8E7',
  moon: '#FFF4D6',
  firefly: '#FFF2A8',
  star: '#FFFFFF',
};

export type Colors = typeof light;

const dark: Colors = {
  bg: '#121A2C',
  card: '#1C2740',
  cardEdge: '#0E1424',
  ink: '#F6EFD9',
  inkSoft: '#B9B3CC',
  pond: '#1F3558',
  pondDeep: '#182A47',
  pondLight: '#2B4A72',
  reed: '#3F6E5A',
  reedDark: '#2F5646',
  primary: '#FFD54F',
  primaryEdge: '#C99A1E',
  onPrimary: '#2A2140',
  secondary: '#2B4A72',
  secondaryEdge: '#1B3050',
  onSecondary: '#F6EFD9',
  accentText: '#8FD3F0',
  ok: '#7FDCA4',
  warn: '#FFB38A',
  sky: '#121A2C',
  moon: '#FFF4D6',
  firefly: '#FFF2A8',
  star: '#FFFFFF',
};

/** Embedded at build time by the expo-font config plugin (see app.json). */
export const fonts = {
  regular: 'Fredoka-Regular',
  semibold: 'Fredoka-SemiBold',
  bold: 'Fredoka-Bold',
};

export const radius = { s: 14, m: 22, l: 30 };
export const space = { xs: 4, s: 8, m: 16, l: 24, xl: 32 };

export type Theme = { dark: boolean; colors: Colors };

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  return isDark ? darkTheme : lightTheme;
}

const lightTheme: Theme = { dark: false, colors: light };
const darkTheme: Theme = { dark: true, colors: dark };
