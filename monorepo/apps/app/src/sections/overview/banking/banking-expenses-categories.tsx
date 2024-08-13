// @ts-nocheck
import type { CardProps } from '@mui/material/Card';
import type { ChartOptions } from 'src/components/chart';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Divider from '@mui/material/Divider';
import { useTheme } from '@mui/material/styles';
import CardHeader from '@mui/material/CardHeader';

import { fCurrency } from 'src/utils/format-number';

import { Chart, useChart, ChartLegends } from 'src/components/chart';
import { ShortCategoryLabels } from 'src/sections/invoice/constants';

// ----------------------------------------------------------------------

type Props = CardProps & {
  title?: string;
  subheader?: string;
  total: number;
  categoriesTotal: number;
  chart: {
    colors?: string[];
    icons?: React.ReactNode[];
    series: {
      label: string;
      value: number;
    }[];
    options?: ChartOptions;
  };
};

export function BankingExpensesCategories({
  title,
  subheader,
  total,
  categoriesTotal,
  chart,
  ...other
}: Props) {
  const theme = useTheme();

  // Calculate percentage data for each category for chart visualization
  const chartSeries = chart.series.map((item) => (item.value / total) * 100);

  const chartOptions = useChart({
    chart: { offsetY: 12 },
    colors: chart.colors ?? [
      theme.palette.warning.main, // Leisure & Entertainment
      theme.palette.primary.light, // Transportation
      theme.palette.error.main, // Food
      theme.palette.success.dark, // Housing
      theme.palette.info.main, // Education
      theme.palette.secondary.main, // Health
      theme.palette.secondary.light, // Personal Expenses
      theme.palette.success.main, // Insurance & Pensions
      theme.palette.warning.light, // Investments
      theme.palette.primary.main, // Debts & Loans
      theme.palette.error.dark, // Credit Card
      theme.palette.info.dark, // Clothing & Accessories
    ],
    labels: chart.series.map((item) => ShortCategoryLabels[item.label]),
    stroke: { width: 1, colors: [theme.palette.background.paper] },
    fill: { opacity: 0.88 },
    tooltip: {
      y: {
        formatter: function (value, { seriesIndex }) {
          // Calculate actual value from percentage
          const actualValue = (value / 100) * total;
          return `${fCurrency(actualValue)} (${value.toFixed(2)}%)`;
        },
      },
    },
    plotOptions: {
      pie: {
        donut: { labels: { show: false } },
        dataLabels: {},
      },
    },
    ...chart.options,
  });

  return (
    <Card {...other}>
      <CardHeader title={title} subheader={subheader} />
      <Box
        sx={{
          pt: 4,
          pb: 3,
          rowGap: 3,
          columnGap: 5,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Chart
          type="pie"
          series={chartSeries}
          options={chartOptions}
          width={{ xs: 240, md: 280 }}
          height={{ xs: 240, md: 280 }}
        />
        <ChartLegends
          colors={chartOptions?.colors}
          labels={chartOptions?.labels}
          icons={chart.icons}
          sublabels={chart.series.map((item) => fCurrency(item.value))}
          sx={{ gap: 2.5, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' }}
        />
      </Box>
      <Divider sx={{ borderStyle: 'dashed' }} />
      <Box
        display="grid"
        gridTemplateColumns="repeat(2, 1fr)"
        sx={{ textAlign: 'center', typography: 'h4' }}
      >
        <Box sx={{ py: 2, borderRight: `dashed 1px ${theme.vars.palette.divider}` }}>
          <Box sx={{ mb: 1, typography: 'body2', color: 'text.secondary' }}>Categorias</Box>
          {categoriesTotal}
        </Box>
        <Box sx={{ py: 2 }}>
          <Box sx={{ mb: 1, typography: 'body2', color: 'text.secondary' }}>Total</Box>
          {fCurrency(total)}
        </Box>
      </Box>
    </Card>
  );
}
