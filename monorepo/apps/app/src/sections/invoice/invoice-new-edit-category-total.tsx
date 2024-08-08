import { useFormContext } from 'react-hook-form';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';

import { Field } from 'src/components/hook-form';
import MenuItem from '@mui/material/MenuItem';
import { useCallback } from 'react';
import InputAdornment from '@mui/material/InputAdornment';
import { CategoryLabels } from './constants';

// ----------------------------------------------------------------------

export function InvoiceNewEditCategoryTotal() {
  const { watch, setValue } = useFormContext();

  const values = watch();

  /**
   * Callbacks
   */

  const handleChangePrice = useCallback(
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setValue('amount', Number(event.target.value));
    },
    [setValue, values.amount]
  );

  const renderTotal = (
    <Stack spacing={2} direction={{ xs: 'column', sm: 'row' }}>
      <Field.Select
        fullWidth
        name="category"
        label="Categoria"
        InputLabelProps={{ shrink: true }}
        value={values.category || ''}
      >
        {Object.entries(CategoryLabels).map(([value, label]) => (
          <MenuItem key={value} value={value} sx={{ textTransform: 'capitalize' }}>
            {label}
          </MenuItem>
        ))}
      </Field.Select>
      <Field.Text
        type="number"
        name="amount"
        label="Valor"
        placeholder="0.00"
        onChange={(event) => handleChangePrice(event)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Box sx={{ typography: 'subtitle2', color: 'text.disabled' }}>R$</Box>
            </InputAdornment>
          ),
        }}
      />
    </Stack>
  );

  return <Box sx={{ p: 3 }}>{renderTotal}</Box>;
}
