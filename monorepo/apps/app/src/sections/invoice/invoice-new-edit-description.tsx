import { useFormContext } from 'react-hook-form';

import Stack from '@mui/material/Stack';

import Divider from '@mui/material/Divider';

import { useResponsive } from 'src/hooks/use-responsive';

import { _addressBooks } from 'src/_mock';

import { Field } from 'src/components/hook-form';

// ----------------------------------------------------------------------

export function InvoiceNewEditDescription() {
  const { watch } = useFormContext();

  const mdUp = useResponsive('up', 'md');

  const values = watch();

  return (
    <>
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
            <Field.Text name="description" label="Descrição" value={values.description} />
          </Stack>
        </Stack>
      </Stack>
    </>
  );
}
