export type UserType = {
  id: string;
  email: string;
  name: string;
  photo: string;
  hasPendingProcess: boolean;
  createdAt: Date;
  updatedAt: Date;
} | null;

export type AuthState = {
  user: UserType;
  loading: boolean;
};

export type AuthContextValue = {
  user: UserType;
  loading: boolean;
  authenticated: boolean;
  unauthenticated: boolean;
  checkUserSession?: () => Promise<void>;
};
