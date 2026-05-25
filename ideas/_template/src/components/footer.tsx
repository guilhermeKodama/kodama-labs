import { Separator } from "@/components/ui/separator";

export function Footer() {
  return (
    <footer className="flex flex-col gap-3 text-xs text-muted-foreground">
      <Separator />
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <span>
          © {new Date().getFullYear()} {"{{IDEA_NAME}}"}
        </span>
        <span>Validation prototype — Kodama Labs.</span>
      </div>
    </footer>
  );
}
