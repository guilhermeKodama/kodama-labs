import { useFieldArray, useFormContext } from 'react-hook-form';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import InputAdornment from '@mui/material/InputAdornment';

import { fCurrency } from 'src/utils/format-number';

import { Field } from 'src/components/hook-form';
import { Iconify } from 'src/components/iconify';
import {
  ExpenseCategory,
  IncomeCategory,
  TransactionSubItem,
  TransactionType,
} from 'src/types/api';
import { CategoryLabels } from './constants';

// ----------------------------------------------------------------------

export function InvoiceNewEditSubItems() {
  const { control, setValue, watch } = useFormContext();

  const { fields, append, remove } = useFieldArray({ control, name: 'subItems' });

  const values = watch();

  const totalOnRow: number[] = values.subItems.map((item: TransactionSubItem) => item.amount);

  const subtotal = totalOnRow.reduce((acc, num) => acc + num, 0);

  const totalAmount = subtotal;

  const categoryOptions =
    values.type === TransactionType.INCOME
      ? Object.entries(CategoryLabels).filter(([key]) =>
          Object.values(IncomeCategory).includes(key as IncomeCategory)
        )
      : Object.entries(CategoryLabels).filter(([key]) =>
          Object.values(ExpenseCategory).includes(key as ExpenseCategory)
        );

  const handleAdd = () => {
    append({
      description: '',
      category: '',
      amount: 0,
    });
  };

  const handleRemove = (index: number) => {
    remove(index);
  };

  const handleClearService = (index: number) => {
    setValue(`subItems[${index}].amount`, 0);
  };

  const handleFieldChange = (index: number, field: string, value: any) => {
    setValue(`subItems[${index}].${field}`, value); // Update the field value
    setValue(`subItems[${index}].hasChanged`, true); // Mark the item as changed
  };

  const handleChangePrice = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    index: number
  ) => {
    handleFieldChange(index, 'amount', Number(event.target.value));
  };

  const renderTotal = (
    <Stack
      spacing={2}
      alignItems="flex-end"
      sx={{ mt: 3, textAlign: 'right', typography: 'body2' }}
    >
      <Stack direction="row" sx={{ typography: 'subtitle1' }}>
        <div>Total</div>
        <Box sx={{ width: 160 }}>{fCurrency(totalAmount) || '-'}</Box>
      </Stack>
    </Stack>
  );

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6" sx={{ color: 'text.disabled', mb: 3 }}>
        Items:
      </Typography>

      <Stack divider={<Divider flexItem sx={{ borderStyle: 'dashed' }} />} spacing={3}>
        {fields.map((item, index) => (
          <Stack key={item.id} alignItems="flex-end" spacing={1.5}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ width: 1 }}>
              <Field.Text
                size="small"
                name={`subItems[${index}].description`}
                label="Descrição"
                InputLabelProps={{ shrink: true }}
                onChange={(event) => handleFieldChange(index, 'description', event.target.value)}
              />

              <Field.Select
                name={`subItems[${index}].category`}
                size="small"
                label="Categoria"
                InputLabelProps={{ shrink: true }}
                sx={{ maxWidth: { md: 160 } }}
                onChange={(event) => handleFieldChange(index, 'category', event.target.value)}
              >
                <MenuItem
                  value=""
                  onClick={() => handleClearService(index)}
                  sx={{ fontStyle: 'italic', color: 'text.secondary' }}
                >
                  None
                </MenuItem>

                <Divider sx={{ borderStyle: 'dashed' }} />

                {categoryOptions.map(([value, label]) => (
                  <MenuItem key={value} value={value} sx={{ textTransform: 'capitalize' }}>
                    {label}
                  </MenuItem>
                ))}
              </Field.Select>

              <Field.Text
                size="small"
                type="number"
                name={`subItems[${index}].amount`}
                label="Valor"
                placeholder="0.00"
                onChange={(event) => handleChangePrice(event, index)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Box sx={{ typography: 'subtitle2', color: 'text.disabled' }}>$</Box>
                    </InputAdornment>
                  ),
                }}
                sx={{ maxWidth: { md: 96 } }}
              />
              <Button
                size="small"
                color="error"
                startIcon={<Iconify icon="solar:trash-bin-trash-bold" />}
                onClick={() => handleRemove(index)}
              ></Button>
            </Stack>
          </Stack>
        ))}
      </Stack>

      <Divider sx={{ my: 3, borderStyle: 'dashed' }} />

      <Stack
        spacing={3}
        direction={{ xs: 'column', md: 'row' }}
        alignItems={{ xs: 'flex-end', md: 'center' }}
      >
        <Button
          size="small"
          color="primary"
          startIcon={<Iconify icon="mingcute:add-line" />}
          onClick={handleAdd}
          sx={{ flexShrink: 0 }}
        >
          Adicionar Item
        </Button>
      </Stack>

      {renderTotal}
    </Box>
  );
}
