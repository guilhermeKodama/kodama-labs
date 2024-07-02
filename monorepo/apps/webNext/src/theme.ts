'use client'

import { alpha, createTheme } from '@mui/material/styles'
import { responsiveFontSizes } from '@mui/material'

const theme = responsiveFontSizes(
  createTheme({
    shadows: [
      'none',
      `0 3px 6px 0 ${alpha('#000000', 0.25)}`,
      `0 12px 15px ${alpha('#000000', 0.1)}`,
      `0 6px 24px 0 ${alpha('#000000', 0.125)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
      `0 10px 40px 10px ${alpha('#000000', 0.175)}`,
    ],
    typography: {
      fontFamily: '"Manrope", sans-serif',
      button: {
        textTransform: 'none',
        fontWeight: 'medium',
      },
    },
    zIndex: {
      appBar: 1200,
      drawer: 1300,
    },
    components: {
      MuiButton: {
        styleOverrides: {
          containedSecondary: {},
        },
      },
    },
    palette: {
      common: {
        black: '#000',
        white: '#fff',
      },
      mode: 'dark',
      primary: {
        main: '#4caf50',
        light: '#6fbf73',
        dark: '#357a38',
        contrastText: '#fff',
      },
      secondary: {
        light: '#33eb91',
        main: '#00e676',
        dark: '#00a152',
        contrastText: '#ffffff',
      },
      text: {
        primary: '#ffffff',
        secondary: '#eff2fc',
      },
      divider: 'rgba(255, 255, 255, 0.12)',
      background: {
        paper: '#161c23',
        default: '#161c23',
      },
    },
  })
)

export default theme
