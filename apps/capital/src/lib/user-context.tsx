"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { client } from "@/lib/api-client";

interface User {
  id: string;
  email: string;
  name: string;
  baseCurrency: string;
  theme: string;
  dateFormat: string;
  numberFormat: string;
  personalAccountId: string | null;
}

interface UserContextValue {
  user: User | null;
  userId: string | null;
  personalAccountId: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  refetchUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCurrentUser = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await client.v1.auth.me.$get();

      if (res.ok) {
        const userData = await res.json();
        setUser({
          id: userData.id,
          email: userData.email,
          name: userData.name,
          baseCurrency: userData.baseCurrency,
          theme: userData.theme,
          dateFormat: userData.dateFormat,
          numberFormat: userData.numberFormat,
          personalAccountId: userData.personalAccount?.id ?? null,
        });
      } else {
        // Not authenticated - this is expected for public routes
        setUser(null);
      }
    } catch (err) {
      console.error("User context error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await client.v1.auth.logout.$post();
      setUser(null);
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  return (
    <UserContext.Provider
      value={{
        user,
        userId: user?.id ?? null,
        personalAccountId: user?.personalAccountId ?? null,
        isLoading,
        isAuthenticated: !!user,
        error,
        refetchUser: fetchCurrentUser,
        logout,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}

export function useUserId() {
  const { userId } = useUser();
  return userId;
}

export function usePersonalAccountId() {
  const { personalAccountId } = useUser();
  return personalAccountId;
}
