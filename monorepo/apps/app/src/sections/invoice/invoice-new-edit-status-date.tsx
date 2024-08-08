import Stack from '@mui/material/Stack';
import MenuItem from '@mui/material/MenuItem';

import { Field } from 'src/components/hook-form';
import { StatusLabels } from './constants';

// ----------------------------------------------------------------------

export function InvoiceNewEditStatusDate() {
  return (
    <Stack
      spacing={2}
      direction={{ xs: 'column', sm: 'row' }}
      sx={{ p: 3, bgcolor: 'background.neutral' }}
    >
      <Field.Select fullWidth name="status" label="Status" InputLabelProps={{ shrink: true }}>
        {['paid', 'pending', 'overdue', 'draft'].map((option) => (
          <MenuItem key={option} value={option} sx={{ textTransform: 'capitalize' }}>
            {StatusLabels[option]}
          </MenuItem>
        ))}
      </Field.Select>

      <Field.DatePicker name="createdAt" label="Data de criação" />
      <Field.DatePicker name="dueAt" label="Data de vencimento" />
    </Stack>
  );
}
