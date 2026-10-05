"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface User {
  id: string;
  email: string;
  name: string;
  baseCurrency: string;
  theme: string;
  dateFormat: string;
  numberFormat: string;
  timezone: string;
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
      const res = await fetch("/api/v2/me", { credentials: "include" });
      if (res.ok) {
        const me = await res.json();
        setUser({
          id: me.id,
          email: me.email,
          name: me.name,
          baseCurrency: me.baseCurrency,
          theme: me.theme,
          dateFormat: me.dateFormat,
          numberFormat: me.numberFormat,
          timezone: me.timezone,
          personalAccountId: me.personalEntityId ?? null,
        });
      } else {
        // Not authenticated - expected on public routes.
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
      await fetch("/api/v2/auth/logout", { method: "POST", credentials: "include" });
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
  if (!context) throw new Error("useUser must be used within a UserProvider");
  return context;
}

export function useUserId() {
  return useUser().userId;
}

export function usePersonalAccountId() {
  return useUser().personalAccountId;
}
