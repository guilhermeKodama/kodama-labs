import { Plane } from "lucide-react";

export function Logo() {
  return (
    <span className="flex items-center gap-2 font-serif text-lg font-normal tracking-tight">
      <Plane
        className="size-4 -rotate-12 text-primary"
        strokeWidth={1.75}
        aria-hidden
      />
      <span>MilhasGrupo</span>
    </span>
  );
}
