import { Separator } from "@/components/ui/separator";
import { Logo } from "@/components/logo";

export function Footer() {
  return (
    <footer className="flex flex-col gap-4 text-xs text-muted-foreground">
      <Separator />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Logo />
        <div className="flex flex-col gap-1 sm:items-end">
          <span>© {new Date().getFullYear()} MilhasGrupo</span>
          <span>
            Não somos afiliados a Azul, LATAM, Smiles, Walt Disney Co. ou
            Universal.
          </span>
        </div>
      </div>
    </footer>
  );
}
