import type { ReactNode, Dispatch, SetStateAction } from 'react';
import React, { createContext, useState, useEffect, useMemo } from 'react';
import type { Transaction } from 'src/types/api';

interface TransactionContextType {
  transactions: Transaction[];
  setTransactions: Dispatch<SetStateAction<Transaction[]>>;
}

const defaultValue: TransactionContextType = {
  transactions: [],
  setTransactions: () => {},
};

export const TransactionContext = createContext<TransactionContextType>(defaultValue);

interface TransactionProviderProps {
  children: ReactNode;
}

export const TransactionProvider: React.FC<TransactionProviderProps> = ({ children }) => {
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const savedTransactions = localStorage.getItem('transactions');
    return savedTransactions ? JSON.parse(savedTransactions) : [];
  });

  useEffect(() => {
    localStorage.setItem('transactions', JSON.stringify(transactions));
  }, [transactions]);

  const value = useMemo(() => ({ transactions, setTransactions }), [transactions, setTransactions]);

  return <TransactionContext.Provider value={value}>{children}</TransactionContext.Provider>;
};
