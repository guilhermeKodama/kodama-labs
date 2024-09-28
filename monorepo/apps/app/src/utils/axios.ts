import type { AxiosRequestConfig } from 'axios';

import axios from 'axios';
import { STORAGE_KEY } from 'src/auth/context/jwt/constant';

import { CONFIG } from 'src/config-global';

// ----------------------------------------------------------------------

const axiosInstance = axios.create({ baseURL: CONFIG.site.serverUrl });

axiosInstance.interceptors.request.use(
  (config) => {
    // Get the token from storage (e.g., localStorage)
    const token = sessionStorage.getItem(STORAGE_KEY);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject((error.response && error.response.data) || 'Something went wrong!')
);

export default axiosInstance;

// ----------------------------------------------------------------------

export const fetcher = async (args: string | [string, AxiosRequestConfig]) => {
  try {
    const [url, config] = Array.isArray(args) ? args : [args];

    const res = await axiosInstance.get(url, { ...config });

    return res.data;
  } catch (error) {
    console.error('Failed to fetch:', error);
    throw error;
  }
};

// ----------------------------------------------------------------------

export const endpoints = {
  auth: {
    me: '/auth/me',
  },
  user: {
    transactions: '/user/transactions',
    createTransaction: '/user/transaction',
    updateTransaction: '/user/transaction',
    deleteTransaction: '/user/transaction',
    deleteTransactions: '/user/transactions',
    setPDFPassword: '/user/pdf/set-password',
    pooling: '/user/pooling',
  },
};
