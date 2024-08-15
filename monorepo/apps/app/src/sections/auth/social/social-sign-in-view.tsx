import { z as zod } from 'zod';
import { useForm } from 'react-hook-form';
import { useState, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';

import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';

import { Google as GoogleIcon } from '@mui/icons-material';

import { Form } from 'src/components/hook-form';

import { setSession } from 'src/auth/context/jwt';
import { useAuthContext } from 'src/auth/hooks';

import { CONFIG } from 'src/config-global';

export type SignInSchemaType = zod.infer<typeof SignInSchema>;

export const SignInSchema = zod.object({
  email: zod
    .string()
    .min(1, { message: 'Email is required!' })
    .email({ message: 'Email must be a valid email address!' }),
  password: zod
    .string()
    .min(1, { message: 'Password is required!' })
    .min(6, { message: 'Password must be at least 6 characters!' }),
});

export function SocialSignInView() {
  const [errorMsg, setErrorMsg] = useState('');
  const [token, setToken] = useState('');
  const { checkUserSession } = useAuthContext();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromParam = params.get('token');

    if (tokenFromParam) {
      setToken(tokenFromParam);
    }
  }, []);

  useEffect(() => {
    const setSessionAndCheckUser = async () => {
      if (token) {
        setSession(token);
        await checkUserSession?.();
      }
    };

    setSessionAndCheckUser();
  }, [token, checkUserSession]);

  const defaultValues = {
    email: 'guilherme.kodama@gmail.com',
    password: '@demo1',
  };

  const methods = useForm<SignInSchemaType>({
    resolver: zodResolver(SignInSchema),
    defaultValues,
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  const onSubmit = handleSubmit(async () => {
    try {
      window.location.href = `${CONFIG.site.serverUrl}/auth/google/login`;
    } catch (error) {
      console.error(error);
      setErrorMsg(error instanceof Error ? error.message : error);
    }
  });

  const renderHead = (
    <Stack spacing={1.5} sx={{ mb: 5 }}>
      <Typography variant="h5">Bem-vindo</Typography>
    </Stack>
  );

  const renderForm = (
    <Stack spacing={3}>
      <LoadingButton
        startIcon={<GoogleIcon />}
        fullWidth
        color="inherit"
        size="large"
        type="submit"
        variant="contained"
        loading={isSubmitting}
        loadingIndicator="Sign in..."
      >
        Continue com o Google
      </LoadingButton>
    </Stack>
  );

  return (
    <>
      {renderHead}

      {!!errorMsg && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {errorMsg}
        </Alert>
      )}

      <Form methods={methods} onSubmit={onSubmit}>
        {renderForm}
      </Form>
    </>
  );
}
