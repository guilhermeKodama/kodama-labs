"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Menu } from "lucide-react";
import { MobileLanguageSwitcher } from "./mobile-language-switcher";
import { NavLinks } from "./nav-links";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";

export function MobileTopBar() {
  const tApp = useTranslations("app");
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");
  const [open, setOpen] = useState(false);

  return (
    <header className="md:hidden flex-shrink-0 flex items-center gap-3 border-b bg-card px-4 h-14">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          aria-label={tNav("openMenu")}
          className="inline-flex items-center justify-center rounded-md p-2 -ml-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Menu className="h-5 w-5" />
        </SheetTrigger>
        <SheetContent side="left" className="p-0">
          <SheetHeader>
            <SheetTitle>{tApp("name")}</SheetTitle>
            <SheetDescription>{tApp("tagline")}</SheetDescription>
          </SheetHeader>
          <NavLinks onNavigate={() => setOpen(false)} />
          <SheetFooter className="flex-col items-stretch gap-3">
            <MobileLanguageSwitcher />
            <p className="text-[11px] text-muted-foreground">{tCommon("version")}</p>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <h1 className="text-base font-bold tracking-tight">{tApp("name")}</h1>
    </header>
  );
}
