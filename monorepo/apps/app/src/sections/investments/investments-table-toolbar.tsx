import { CardHeader, TextField, InputAdornment } from '@mui/material';

import { Iconify } from 'src/components/iconify';

// ----------------------------------------------------------------------

export default function InvestmentsTableToolbar() {
  return (
    <CardHeader
      title="Investimentos"
      action={
        <TextField
          size="small"
          placeholder="Buscar..."
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Iconify icon="eva:search-fill" sx={{ color: 'text.disabled' }} />
              </InputAdornment>
            ),
          }}
        />
      }
    />
  );
} 