import { Transaction, UserTransactionsReponse, TransactionType } from 'src/types/api';
import axios, { endpoints } from 'src/utils/axios';

const refetchInvestments = async (setTransactions: (transactions: Transaction[]) => void): Promise<void> => {
  try {
    const response = await axios.get(endpoints.user.transactions);
    const data: UserTransactionsReponse = response.data;

    const STATUS_MAP = {
      PENDING: 'pending',
      PAID: 'paid',
      OVERDUE: 'overdue',
      DRAFT: 'draft',
    };

    // Filter only investment transactions and map their status
    const investmentsMapped: Transaction[] = data.transactions
      .filter((transaction) => transaction.type === TransactionType.INVESTMENT)
      .map((transaction) => ({
        ...transaction,
        status: STATUS_MAP[transaction.status as keyof typeof STATUS_MAP] || STATUS_MAP.DRAFT,
      }));

    setTransactions(investmentsMapped);
  } catch (error) {
    console.error('Error fetching investments:', error);
    throw error; // Re-throw to let the component handle the error
  }
};

export default {
  refetchInvestments,
}; 