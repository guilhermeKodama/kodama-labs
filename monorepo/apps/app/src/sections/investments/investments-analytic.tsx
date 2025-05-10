import { Card, CardHeader, CardContent, Stack, Typography } from '@mui/material';

import { fCurrency } from 'src/utils/format-number';

// ----------------------------------------------------------------------

type Props = {
  title: string;
  total: number;
  icon: React.ReactNode;
  color?: string;
  subheader?: string;
};

export default function InvestmentsAnalytic({ title, total, icon, color = 'primary', subheader }: Props) {
  return (
    <Card>
      <CardHeader title={title} subheader={subheader ?? 'Total'} />

      <CardContent>
        <Stack direction="row" alignItems="center" spacing={2}>
          {icon}

          <Stack spacing={0.5}>
            <Typography variant="h4">{fCurrency(total)}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {title === 'Retorno' ? 'Percentual' : 'Valor Total'}
            </Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
} 