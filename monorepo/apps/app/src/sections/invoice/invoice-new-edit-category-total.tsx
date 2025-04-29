import { useFormContext, Controller } from 'react-hook-form';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';
import { NumericFormat } from 'react-number-format';
import { Field } from 'src/components/hook-form';
import { ExpenseCategory, IncomeCategory, TransactionType, InvestmentCategory } from 'src/types/api';
import { CategoryLabels } from './constants';

// ----------------------------------------------------------------------

export function InvoiceNewEditCategoryTotal() {
  const { watch, setValue, control } = useFormContext();

  const values = watch();

  // Determine which categories to display based on the transaction type
  const categoryOptions =
    values.type === TransactionType.INCOME
      ? Object.entries(CategoryLabels).filter(([key]) =>
          Object.values(IncomeCategory).includes(key as IncomeCategory)
        )
      : values.type === TransactionType.EXPENSE
      ? Object.entries(CategoryLabels).filter(([key]) =>
          Object.values(ExpenseCategory).includes(key as ExpenseCategory)
        )
      : Object.entries(CategoryLabels).filter(([key]) =>
          Object.values(InvestmentCategory).includes(key as InvestmentCategory)
        );

  /**
   * Callbacks
   */
  const handleChangePrice = (fieldValues: { floatValue: number | undefined }) => {
    const amount = fieldValues.floatValue || 0; // Use float value for amount
    setValue('amount', amount); // Set amount as a float
  };

  const renderTotal = (
    <Stack spacing={2} direction={{ xs: 'column', sm: 'row' }}>
      <Field.Select
        fullWidth
        name="category"
        label="Categoria"
        InputLabelProps={{ shrink: true }}
        value={values.category || ''}
      >
        {categoryOptions.map(([value, label]) => (
          <MenuItem key={value} value={value} sx={{ textTransform: 'capitalize' }}>
            {label}
          </MenuItem>
        ))}
      </Field.Select>

      {values.subItems.length === 0 && (
        <Controller
          disabled={values.subItems.length > 0}
          name="amount"
          control={control}
          render={({ field: { onChange, value, ...field } }) => (
            <NumericFormat
              {...field}
              value={value === 0 || value === null ? '' : value}
              customInput={Field.Text}
              thousandSeparator="."
              decimalSeparator=","
              decimalScale={2}
              fixedDecimalScale
              allowNegative={false}
              onValueChange={handleChangePrice}
              placeholder="0,00"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Box sx={{ typography: 'subtitle2', color: 'text.disabled' }}>R$</Box>
                  </InputAdornment>
                ),
              }}
              fullWidth
              label="Valor"
            />
          )}
        />
      )}
    </Stack>
  );

  return <Box sx={{ p: 3 }}>{renderTotal}</Box>;
}
