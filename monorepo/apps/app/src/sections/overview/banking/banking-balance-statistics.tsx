import type { CardProps } from '@mui/material/Card';
import type { ChartOptions } from 'src/components/chart';

import { useState, useCallback, useMemo } from 'react';

import Card from '@mui/material/Card';
import { useTheme } from '@mui/material/styles';
import CardHeader from '@mui/material/CardHeader';

import { fPercent, fCurrency } from 'src/utils/format-number';

import { Chart, useChart, ChartSelect, ChartLegends } from 'src/components/chart';

// ----------------------------------------------------------------------

type Props = CardProps & {
  title?: string;
  subheader?: string;
  chart: {
    colors?: string[];
    series: {
      name: string;
      categories: string[];
      data: {
        name: string;
        data: number[];
      }[];
    }[];
    options?: ChartOptions;
  };
};

// Calculates percentual variance
const calculatePercentualVariance = (numbers: number[]): number => {
  if (numbers.length === 0) {
    return 0; // or another appropriate value for your use case
  }

  // Calculate the mean
  const mean = numbers.reduce((sum, num) => sum + num, 0) / numbers.length;

  // Handle case where mean is zero to avoid division by zero
  if (mean === 0) {
    return 0;
  }

  // Calculate the variance
  const variance = numbers.reduce((sum, num) => sum + Math.pow(num - mean, 2), 0) / numbers.length;

  // Calculate the standard deviation
  const standardDeviation = Math.sqrt(variance);

  // Calculate the percentual variance
  const percentualVariance = (standardDeviation / mean) * 100;

  return percentualVariance;
};

export function BankingBalanceStatistics({ title, subheader, chart, ...other }: Props) {
  const theme = useTheme();

  const [selectedSeries, setSelectedSeries] = useState('Mensal');

  const currentSeries = chart.series.find((i) => i.name === selectedSeries);

  const chartColors = chart.colors ?? [
    theme.palette.primary.dark,
    theme.palette.warning.main,
    theme.palette.info.main,
  ];

  const chartOptions = useChart({
    stroke: { width: 2, colors: ['transparent'] },
    colors: chartColors,
    xaxis: { categories: currentSeries?.categories },
    yaxis: {
      labels: {
        formatter: (value: number) => fCurrency(value),
      },
    },
    tooltip: { y: { formatter: (value: number) => fCurrency(value) } },
    ...chart.options,
  });

  const handleChangeSeries = useCallback((newValue: string) => {
    setSelectedSeries(newValue);
  }, []);

  // Calculates percentual variance for each dataset in the series
  const percentualVariances = useMemo(() => {
    if (!currentSeries) return [];

    return currentSeries.data.map((item) => {
      const variance = calculatePercentualVariance(item.data);
      return variance;
    });
  }, [currentSeries]);

  // Format percentual variances for display
  const sublabels = useMemo(() => {
    return percentualVariances.map((variance) =>
      variance >= 0 ? `+${fPercent(variance)}` : `-${fPercent(variance)}`
    );
  }, [percentualVariances]);

  // Calculate the sum for each dataset
  const values = useMemo(() => {
    if (!currentSeries) return [];

    return currentSeries.data.map((item) =>
      fCurrency(item.data.reduce((sum, value) => sum + value, 0))
    );
  }, [currentSeries]);

  console.log({ chartOptions });

  return (
    <Card {...other}>
      <CardHeader
        title={title}
        subheader={subheader}
        action={
          <ChartSelect
            options={chart.series.map((item) => item.name)}
            value={selectedSeries}
            onChange={handleChangeSeries}
          />
        }
        sx={{ mb: 3 }}
      />

      <ChartLegends
        colors={chartOptions?.colors}
        labels={currentSeries?.data.map((item) => item.name) ?? []}
        sublabels={sublabels} // Display the percentual variances
        values={values}
        sx={{ px: 3, gap: 3 }}
      />

      <Chart
        type="bar"
        series={currentSeries?.data}
        options={chartOptions}
        height={320}
        sx={{ py: 2.5, pl: 1, pr: 2.5 }}
      />
    </Card>
  );
}
