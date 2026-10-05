import { redirect } from 'next/navigation';

// The middleware already sends "/" to /transactions or /login; this only
// covers a request that reaches the page anyway. Without a session the
// middleware sends /transactions on to /login.
export default function HomePage() {
  redirect('/transactions');
}
