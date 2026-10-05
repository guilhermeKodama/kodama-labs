"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { isUnauthenticated, useSession } from "@/lib/session";

export default function HomePage() {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session.isPending) return;
    const loggedOut = session.isError && isUnauthenticated(session.error);
    router.replace(session.data && !loggedOut ? "/transactions" : "/login");
  }, [session.isPending, session.data, session.isError, session.error, router]);

  return null;
}
