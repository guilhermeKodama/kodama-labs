"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      data-scrolled={scrolled}
      className="sticky top-0 z-40 border-b border-transparent bg-background/80 backdrop-blur-md transition-colors data-[scrolled=true]:border-border"
    >
      <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <Link href="/" aria-label="MilhasGrupo">
          <Logo />
        </Link>
        <Button asChild size="sm" className="hidden sm:inline-flex">
          <Link href="/start">Cadastrar viagem</Link>
        </Button>
      </nav>
    </header>
  );
}
