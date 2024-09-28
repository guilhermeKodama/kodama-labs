import { useState, useEffect, useCallback } from 'react';

import { paths } from 'src/routes/paths';
import { useRouter, usePathname, useSearchParams } from 'src/routes/hooks';

import { CONFIG } from 'src/config-global';

import { SplashScreen } from 'src/components/loading-screen';

import axios, { endpoints } from 'src/utils/axios';

import { useAuthContext } from '../hooks';

// ----------------------------------------------------------------------

type Props = {
  children: React.ReactNode;
};

export function AuthGuard({ children }: Props) {
  const router = useRouter();

  const pathname = usePathname();

  const searchParams = useSearchParams();

  const { authenticated, loading } = useAuthContext();

  const [isChecking, setIsChecking] = useState<boolean>(true);

  const [isPolling, setIsPolling] = useState(false);

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(name, value);

      return params.toString();
    },
    [searchParams]
  );

  const checkPermissions = async (): Promise<void> => {
    if (loading) {
      return;
    }

    if (!authenticated) {
      const { method } = CONFIG.auth;

      const signInPath = {
        jwt: paths.auth.jwt.signIn,
        auth0: paths.auth.auth0.signIn,
        amplify: paths.auth.amplify.signIn,
        firebase: paths.auth.firebase.signIn,
        supabase: paths.auth.supabase.signIn,
      }[method];

      const href = `${signInPath}?${createQueryString('returnTo', pathname)}`;

      router.replace(href);
      return;
    }

    setIsChecking(false);
  };

  const startPolling = useCallback(() => {
    setIsPolling(true);
    axios
      .get(endpoints.user.pooling)
      .then((res: { data: { hasPendingProcess: boolean } }) => {
        console.log({ data: res.data });
        if (res.data.hasPendingProcess) {
          // if there is a pending process, poll again in 1 second
          setTimeout(() => {
            startPolling();
          }, 1 * 1000);
          return;
        } else {
          // if there is no pending process, poll again in 10 seconds
          setTimeout(() => {
            startPolling();
          }, 10 * 1000);
        }
      })
      .catch((error) => {
        console.error('Error during polling:', error);
      });
  }, []);

  useEffect(() => {
    if (authenticated && !isPolling) {
      startPolling(); // Start polling after authentication
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  useEffect(() => {
    checkPermissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, loading]);

  if (isChecking) {
    return <SplashScreen />;
  }

  return <>{children}</>;
}
