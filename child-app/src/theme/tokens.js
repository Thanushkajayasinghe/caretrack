// Design Tokens — CareTrack Child App
// Shared dark-mode design system

export const Colors = {
  // Backgrounds
  bg: {
    primary: '#0A0E1A',       // Deep navy black
    secondary: '#111827',     // Card background
    tertiary: '#1A2236',      // Elevated surface
    glass: 'rgba(26, 34, 54, 0.85)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
  },

  // Brand
  brand: {
    primary: '#6C63FF',       // Violet
    secondary: '#FF6584',     // Coral pink
    accent: '#43E8D8',        // Teal accent
    gradient: ['#6C63FF', '#8B5CF6'],
  },

  // Status
  status: {
    online: '#10B981',        // Emerald green
    offline: '#6B7280',       // Gray
    charging: '#F59E0B',      // Amber
    danger: '#EF4444',        // Red
    warning: '#F59E0B',       // Amber
    speed: {
      low: '#10B981',         // Green (<20 km/h)
      medium: '#F59E0B',      // Amber (20–60 km/h)
      high: '#EF4444',        // Red (>60 km/h)
    },
  },

  // Text
  text: {
    primary: '#F9FAFB',
    secondary: '#9CA3AF',
    tertiary: '#6B7280',
    inverse: '#0A0E1A',
  },

  // Map
  map: {
    accuracy: 'rgba(108, 99, 255, 0.15)',
    accuracyBorder: 'rgba(108, 99, 255, 0.4)',
    trail: '#6C63FF',
    trailLow: '#10B981',
    trailMedium: '#F59E0B',
    trailHigh: '#EF4444',
  },
};

import { Platform } from 'react-native';

export const Fonts = {
  regular: Platform.OS === 'ios' ? 'Inter-Regular' : 'sans-serif',
  medium: Platform.OS === 'ios' ? 'Inter-Medium' : 'sans-serif-medium',
  semiBold: Platform.OS === 'ios' ? 'Inter-SemiBold' : 'sans-serif-medium',
  bold: Platform.OS === 'ios' ? 'Inter-Bold' : 'sans-serif-bold',
  sizes: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 24,
    xxxl: 32,
    display: 42,
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  section: 40,
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  full: 999,
};

export const Shadows = {
  sm: {
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  md: {
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 6,
  },
  lg: {
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 12,
  },
};
