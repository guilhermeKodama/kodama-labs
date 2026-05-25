export function Footer() {
  return (
    <footer className="flex flex-col gap-1 border-t border-border pt-6 text-xs text-muted-foreground">
      <span>© {new Date().getFullYear()} {"{{IDEA_NAME}}"}</span>
      <span>Validation prototype — Kodama Labs.</span>
    </footer>
  );
}
