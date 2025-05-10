import { Helmet } from 'react-helmet-async';
import { useEffect, useContext, useMemo, useState } from 'react';
import { Container, Grid, Card } from '@mui/material';
import { TransactionType } from 'src/types/api';
import { TransactionContext } from 'src/pages/dashboard/invoice/transaction-context';
import { useBoolean } from 'src/hooks/use-boolean';
import { Iconify } from 'src/components/iconify';
import investmentsService from 'src/modules/investments/services/investments.service';
import { LoadingScreen } from 'src/components/loading-screen';
import InvestmentsAnalytic from './investments-analytic';
import InvestmentsTable from './investments-table';

// ----------------------------------------------------------------------

const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price';

async function fetchCryptoPrices(symbols: string[]): Promise<Record<string, number>> {
  // Map symbols to CoinGecko IDs
  const symbolToId: Record<string, string> = {
    BTC: 'bitcoin',
    ETH: 'ethereum',
    BNB: 'binancecoin',
    ADA: 'cardano',
    SOL: 'solana',
    DOT: 'polkadot',
    DOGE: 'dogecoin',
    AVAX: 'avalanche-2',
    MATIC: 'matic-network',
    LINK: 'chainlink',
    // Add more as needed
  };
  const ids = symbols
    .map((s) => symbolToId[s.toUpperCase()])
    .filter(Boolean)
    .join(',');
  if (!ids) return {};
  const url = `${COINGECKO_API}?ids=${ids}&vs_currencies=brl`;
  const res = await fetch(url);
  const data = await res.json();
  // Map back to symbol: price
  const prices: Record<string, number> = {};
  Object.entries(symbolToId).forEach(([symbol, id]) => {
    if (data[id] && data[id].brl) {
      prices[symbol] = data[id].brl;
    }
  });
  return prices;
}

export default function InvestmentsView() {
  const { transactions, setTransactions } = useContext(TransactionContext);
  const loading = useBoolean(true);
  const [cryptoPrices, setCryptoPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    const fetchInvestments = async () => {
      try {
        await investmentsService.refetchInvestments(setTransactions);
      } catch (error) {
        console.error('Failed to fetch investments:', error);
      } finally {
        loading.onFalse();
      }
    };
    fetchInvestments();
  }, [setTransactions, loading]);

  // Get all investment subitems
  const investments = useMemo(() =>
    transactions.filter((transaction) => transaction.type === TransactionType.INVESTMENT),
    [transactions]
  );
  const allSubItems = useMemo(() =>
    investments.flatMap((tx) => tx.subItems.filter((si) => si.symbol && si.quantity && si.amount)),
    [investments]
  );

  // Fetch live prices for all unique symbols
  useEffect(() => {
    const uniqueSymbols = Array.from(new Set(allSubItems.map((si) => si.symbol?.toUpperCase()).filter(Boolean))) as string[];
    if (uniqueSymbols.length === 0) return;
    fetchCryptoPrices(uniqueSymbols).then(setCryptoPrices).catch(console.error);
  }, [allSubItems]);

  // Calculate total invested, current value, and return
  const totalInvested = useMemo(() =>
    allSubItems.reduce((sum, si) => sum + (si.amount ?? 0) * (si.quantity ?? 0), 0),
    [allSubItems]
  );
  const totalCurrentValue = useMemo(() =>
    allSubItems.reduce((sum, si) => {
      const symbol = si.symbol?.toUpperCase();
      const price = symbol ? cryptoPrices[symbol] : 0;
      return sum + (si.quantity ?? 0) * (price ?? 0);
    }, 0),
    [allSubItems, cryptoPrices]
  );
  const totalReturn = totalCurrentValue - totalInvested;
  const returnPercentage = totalInvested > 0 ? ((totalCurrentValue - totalInvested) / totalInvested) * 100 : 0;

  if (loading.value) {
    return <LoadingScreen />;
  }

  return (
    <>
      <Helmet>
        <title>Investimentos | Wallex</title>
      </Helmet>

      <Container maxWidth="xl">
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <InvestmentsAnalytic
              title="Total Investido"
              total={totalInvested}
              icon={<Iconify icon="mdi:finance" sx={{ width: 40, height: 40 }} />}
            />
          </Grid>

          <Grid item xs={12} md={6}>
            <InvestmentsAnalytic
              title="Retorno"
              total={totalReturn}
              icon={<Iconify icon="mdi:trending-up" sx={{ width: 40, height: 40 }} />}
              subheader={`${returnPercentage.toFixed(2)}%`}
            />
          </Grid>

          <Grid item xs={12}>
            <Card>
              <InvestmentsTable data={investments} />
            </Card>
          </Grid>
        </Grid>
      </Container>
    </>
  );
} 