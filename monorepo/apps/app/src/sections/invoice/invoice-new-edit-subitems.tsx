import { useFieldArray, useFormContext } from 'react-hook-form';
import React from 'react';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
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
  InvestmentCategory,
} from 'src/types/api';
import { CategoryLabels } from './constants';

// List of common cryptocurrencies
const CRYPTO_OPTIONS = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'BNB', name: 'Binance Coin' },
  { symbol: 'ADA', name: 'Cardano' },
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'DOT', name: 'Polkadot' },
  { symbol: 'DOGE', name: 'Dogecoin' },
  { symbol: 'AVAX', name: 'Avalanche' },
  { symbol: 'MATIC', name: 'Polygon' },
  { symbol: 'LINK', name: 'Chainlink' },
];

// ----------------------------------------------------------------------

export function InvoiceNewEditSubItems() {
  const { control, setValue, watch } = useFormContext();

  const { fields, append, remove } = useFieldArray({ control, name: 'subItems' });

  const values = watch();

  const totalOnRow: number[] = values.subItems.map((item: TransactionSubItem) => item.amount);

  const subtotal = totalOnRow.reduce((acc, num) => acc + num, 0);

  const totalAmount = subtotal;

  const isCryptoInvestment = values.type === TransactionType.INVESTMENT && values.category === InvestmentCategory.CRYPTOCURRENCY;

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

  const handleAdd = () => {
    append({
      description: '',
      category: '',
      amount: 0,
      symbol: '',
      quantity: '',
    });
  };

  const handleRemove = (index: number) => {
    remove(index);
  };

  const handleFieldChange = (index: number, field: string, value: any) => {
    setValue(`subItems[${index}].${field}`, value);
    setValue(`subItems[${index}].hasChanged`, true);

    // If symbol is changed, set the description to the crypto name
    if (field === 'symbol') {
      const selectedCrypto = CRYPTO_OPTIONS.find(crypto => crypto.symbol === value);
      if (selectedCrypto) {
        setValue(`subItems[${index}].description`, selectedCrypto.name);
      }
    }

    // If this is a crypto investment, update the quantity based on amount
    if (isCryptoInvestment && field === 'amount') {
      const subItem = values.subItems[index];
      const quantity = subItem.quantity ?? 0;
      if (quantity > 0) {
        // If we have quantity, update amount
        setValue(`subItems[${index}].amount`, value);
      }
    }

    // If quantity changes, recalculate amount
    if (isCryptoInvestment && field === 'quantity') {
      if (value > 0) {
        // Keep the amount as is, just update quantity
        setValue(`subItems[${index}].quantity`, value);
      }
    }
  };

  const handleChangePrice = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    index: number
  ) => {
    handleFieldChange(index, 'amount', Number(event.target.value));
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6" sx={{ color: 'text.disabled', mb: 3 }}>
        {isCryptoInvestment ? 'Investment Details' : 'Items'}
      </Typography>

      <Stack spacing={3}>
        {fields.map((item, index) => (
          <Stack 
            key={item.id} 
            direction="row" 
            spacing={1} 
            alignItems="center"
          >
            {isCryptoInvestment ? (
              <>
                <Field.Select
                  name={`subItems[${index}].symbol`}
                  placeholder="Asset"
                  size="small"
                  value={values.subItems[index]?.symbol ?? ''}
                  onChange={(event) => handleFieldChange(index, 'symbol', event.target.value)}
                  sx={{ flex: 1 }}
                >
                  <MenuItem value="">
                    Select an asset
                  </MenuItem>
                  {CRYPTO_OPTIONS.map((crypto) => (
                    <MenuItem key={crypto.symbol} value={crypto.symbol}>
                      {crypto.symbol} - {crypto.name}
                    </MenuItem>
                  ))}
                </Field.Select>

                <Field.Text
                  size="small"
                  type="number"
                  name={`subItems[${index}].quantity`}
                  placeholder="Quantity"
                  value={values.subItems[index]?.quantity ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    const numericValue = value === '' ? null : parseFloat(value);
                    handleFieldChange(index, 'quantity', numericValue);
                  }}
                  sx={{ width: 100 }}
                  InputProps={{
                    inputProps: {
                      step: 'any',
                      inputMode: 'decimal',
                      min: 0
                    }
                  }}
                />

                <Field.Text
                  size="small"
                  type="number"
                  name={`subItems[${index}].amount`}
                  placeholder="Total Value"
                  value={values.subItems[index]?.amount ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    const numericValue = value === '' ? null : parseFloat(value);
                    handleFieldChange(index, 'amount', numericValue);
                  }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Box sx={{ typography: 'subtitle2', color: 'text.disabled' }}>R$</Box>
                      </InputAdornment>
                    ),
                  }}
                  sx={{ width: 150 }}
                />
              </>
            ) : (
              <>
                <Field.Text
                  size="small"
                  name={`subItems[${index}].description`}
                  placeholder="Description"
                  sx={{ flex: 2 }}
                />

                <Field.Select
                  name={`subItems[${index}].category`}
                  placeholder="Category"
                  size="small"
                  sx={{ width: 200 }}
                >
                  {categoryOptions.map(([value, label]) => (
                    <MenuItem key={value} value={value}>
                      {label}
                    </MenuItem>
                  ))}
                </Field.Select>

                <Field.Text
                  size="small"
                  type="number"
                  name={`subItems[${index}].amount`}
                  placeholder="0.00"
                  onChange={(event) => handleChangePrice(event, index)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Box sx={{ typography: 'subtitle2', color: 'text.disabled' }}>$</Box>
                      </InputAdornment>
                    ),
                  }}
                  sx={{ width: 150 }}
                />
              </>
            )}

            <Button
              size="small"
              color="error"
              onClick={() => handleRemove(index)}
              sx={{ minWidth: 'auto', p: 1 }}
            >
              <Iconify icon="solar:trash-bin-trash-bold" />
            </Button>
          </Stack>
        ))}
      </Stack>

      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mt: 3 }}
      >
        <Button
          size="small"
          color="primary"
          startIcon={<Iconify icon="mingcute:add-line" />}
          onClick={handleAdd}
          sx={{ color: 'primary.main' }}
        >
          {isCryptoInvestment ? 'Add Investment' : 'Add Item'}
        </Button>

        <Stack direction="row" spacing={1} alignItems="center">
          <Typography>Total</Typography>
          <Typography>{fCurrency(totalAmount)}</Typography>
        </Stack>
      </Stack>
    </Box>
  );
}
