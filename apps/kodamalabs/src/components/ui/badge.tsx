import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        outline: "border-border text-foreground",
        live: "border border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
        validating: "border border-violet-400/30 bg-violet-400/10 text-violet-300",
        shipped: "border border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
        archived: "border border-zinc-400/20 bg-zinc-400/5 text-zinc-400",
        muted: "border border-border/60 bg-muted/40 text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
