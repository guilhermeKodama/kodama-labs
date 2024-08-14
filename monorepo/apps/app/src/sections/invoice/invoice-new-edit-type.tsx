import { Controller, useFormContext } from 'react-hook-form';

import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Paper from '@mui/material/Paper';

import { useResponsive } from 'src/hooks/use-responsive';

import { Iconify } from 'src/components/iconify';
import { TransactionType } from 'src/types/api';

// ----------------------------------------------------------------------

export function InvoiceNewEditType() {
  const { control, watch } = useFormContext();

  const mdUp = useResponsive('up', 'md');

  const values = watch();

  console.log({ values });

  return (
    <Stack
        spacing={{ xs: 3, md: 5 }}
        direction={{ xs: 'column', md: 'row' }}
        divider={
          <Divider
            flexItem
            orientation={mdUp ? 'vertical' : 'horizontal'}
            sx={{ borderStyle: 'dashed' }}
          />
        }
        sx={{ p: 3 }}
      >
        <Stack sx={{ width: 1 }}>
          <Stack spacing={1}>
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <Box gap={2} display="grid" gridTemplateColumns="repeat(2, 1fr)">
                  {[
                    {
                      label: 'Receita',
                      value: TransactionType.INCOME,
                      icon: <Iconify icon="mdi:cash-plus" width={32} sx={{ mb: 2 }} />,
                    },
                    {
                      label: 'Despesa',
                      value: TransactionType.EXPENSE,
                      icon: <Iconify icon="mdi:cash-minus" width={32} sx={{ mb: 2 }} />,
                    },
                  ].map((item) => (
                    <Paper
                      component={ButtonBase}
                      variant="outlined"
                      key={item.value}
                      onClick={() => field.onChange(item.value)}
                      sx={{
                        p: 2.5,
                        borderRadius: 1,
                        typography: 'subtitle2',
                        flexDirection: 'column',
                        ...(item.value === field.value && {
                          borderWidth: 2,
                          borderColor: 'text.primary',
                        }),
                      }}
                    >
                      {item.icon}
                      {item.label}
                    </Paper>
                  ))}
                </Box>
              )}
            />
          </Stack>
        </Stack>
      </Stack>
  );
}
