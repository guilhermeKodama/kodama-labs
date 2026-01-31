import { STORAGE_KEY } from './constant';

export async function setSession(accessToken: string | null) {
  try {
    if (accessToken) {
      sessionStorage.setItem(STORAGE_KEY, accessToken);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch (error) {
    console.error('Error during set session:', error);
    throw error;
  }
}
