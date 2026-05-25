export function Footer() {
  return (
    <footer className="flex flex-col gap-1 border-t border-border pt-6 text-xs text-muted-foreground">
      <span>© {new Date().getFullYear()} MilhasGrupo</span>
      <span>Não somos afiliados a Azul, LATAM, Smiles, Walt Disney Co. ou Universal.</span>
    </footer>
  );
}
