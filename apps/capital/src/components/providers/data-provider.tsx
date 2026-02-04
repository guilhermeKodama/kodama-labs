"use client";

import { type ReactNode } from "react";
import { UserProvider } from "@/lib/user-context";
import { DataInitializer } from "./data-initializer";

interface DataProviderProps {
  children: ReactNode;
}

export function DataProvider({ children }: DataProviderProps) {
  return (
    <UserProvider>
      <DataInitializer>{children}</DataInitializer>
    </UserProvider>
  );
}
