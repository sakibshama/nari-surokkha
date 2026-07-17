import { createTheme } from '@mui/material/styles';

export const getAppTheme = (mode: 'light' | 'dark') => {
  return createTheme({
    palette: {
      mode,
      primary: {
        main: mode === 'dark' ? '#22b389' : '#006a4e', // Bangladesh bottle green
        contrastText: '#ffffff',
      },
      secondary: {
        main: '#f42a41', // national flag red
      },
      error: {
        main: '#e11d3a', // emergency red
      },
      success: {
        main: '#006a4e',
      },
      background: {
        default: mode === 'dark' ? '#05100b' : '#eef2f0',
        paper: mode === 'dark' ? '#0a1712' : '#ffffff',
      },
    },
    typography: {
      fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
      h4: {
        fontWeight: 600,
      },
      h5: {
        fontWeight: 600,
      },
      h6: {
        fontWeight: 600,
      },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            borderRadius: 8,
            fontWeight: 600,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            borderRadius: 12,
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: {
            fontWeight: 700,
            backgroundColor: mode === 'dark' ? '#0f2018' : '#f1f6f4',
          },
        },
      },
    },
  });
};
