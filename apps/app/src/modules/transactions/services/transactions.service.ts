import { Transaction, UserTransactionsReponse } from 'src/types/api';
import axios, { endpoints } from 'src/utils/axios';

const refetchTransactions = async (setTransactions: (transactions: Transaction[]) => void) => {
  axios.get(endpoints.user.transactions).then((response) => {
    const data: UserTransactionsReponse = response.data;

    const STATUS_MAP = {
      PENDING: 'pending',
      PAID: 'paid',
      OVERDUE: 'overdue',
      DRAFT: 'draft',
    };

    const transactionsMapped: Transaction[] = data.transactions.map((transaction) => ({
      ...transaction,
      status: STATUS_MAP[transaction.status as keyof typeof STATUS_MAP] || STATUS_MAP.DRAFT,
    }));

    setTransactions(transactionsMapped);
  });
};

export default {
  refetchTransactions,
};
