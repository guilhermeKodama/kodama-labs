import { Separator } from "@/components/ui/separator";

export function Footer() {
  return (
    <footer className="flex flex-col gap-3 text-xs text-muted-foreground">
      <Separator />
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <span>
          <span aria-hidden className="text-accent">·</span> ©{" "}
          {new Date().getFullYear()} MilhasGrupo
        </span>
        <span>
          Não somos afiliados a Azul, LATAM, Smiles, Walt Disney Co. ou
          Universal.
        </span>
      </div>
    </footer>
  );
}
