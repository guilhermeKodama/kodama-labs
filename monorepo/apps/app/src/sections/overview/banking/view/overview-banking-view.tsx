import Box from '@mui/material/Box';
import Grid from '@mui/material/Unstable_Grid2';

import { DashboardContent } from 'src/layouts/dashboard';

import { Iconify } from 'src/components/iconify/iconify';

import { BankingOverview } from '../banking-overview';
import { BankingBalanceStatistics } from '../banking-balance-statistics';
import { BankingExpensesCategories } from '../banking-expenses-categories';

// ----------------------------------------------------------------------

export function OverviewBankingView() {
  return (
    <DashboardContent maxWidth="xl">
      <Grid xs={12} md={7} lg={8}>
        <Box sx={{ gap: 3, display: 'flex', flexDirection: 'column' }}>
          <BankingOverview />

          <BankingBalanceStatistics
            title="Balance statistics"
            subheader="Statistics on balance over time"
            chart={{
              series: [
                {
                  name: 'Weekly',
                  categories: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'],
                  data: [
                    { name: 'Income', data: [24, 41, 35, 151, 49] },
                    { name: 'Savings', data: [24, 56, 77, 88, 99] },
                    { name: 'Investment', data: [40, 34, 77, 88, 99] },
                  ],
                },
                {
                  name: 'Monthly',
                  categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'],
                  data: [
                    { name: 'Income', data: [83, 112, 119, 88, 103, 112, 114, 108, 93] },
                    { name: 'Savings', data: [46, 46, 43, 58, 40, 59, 54, 42, 51] },
                    { name: 'Investment', data: [25, 40, 38, 35, 20, 32, 27, 40, 21] },
                  ],
                },
                {
                  name: 'Yearly',
                  categories: ['2018', '2019', '2020', '2021', '2022', '2023'],
                  data: [
                    { name: 'Income', data: [76, 42, 29, 41, 27, 96] },
                    { name: 'Savings', data: [46, 44, 24, 43, 44, 43] },
                    { name: 'Investment', data: [23, 22, 37, 38, 32, 25] },
                  ],
                },
              ],
            }}
          />

          <BankingExpensesCategories
            title="Expenses categories"
            chart={{
              series: [
                { label: 'Entertainment', value: 22 },
                { label: 'Fuel', value: 18 },
                { label: 'Fast food', value: 16 },
                { label: 'Cafe', value: 17 },
                { label: 'Сonnection', value: 14 },
                { label: 'Healthcare', value: 22 },
                { label: 'Fitness', value: 10 },
                { label: 'Supermarket', value: 21 },
              ],
              icons: [
                <Iconify icon="streamline:dices-entertainment-gaming-dices-solid" />,
                <Iconify icon="maki:fuel" />,
                <Iconify icon="ion:fast-food" />,
                <Iconify icon="maki:cafe" />,
                <Iconify icon="basil:mobile-phone-outline" />,
                <Iconify icon="solar:medical-kit-bold" />,
                <Iconify icon="ic:round-fitness-center" />,
                <Iconify icon="solar:cart-3-bold" />,
              ],
            }}
          />
        </Box>
      </Grid>
    </DashboardContent>
  );
}
