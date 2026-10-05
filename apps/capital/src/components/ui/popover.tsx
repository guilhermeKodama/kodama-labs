"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { OverlayScope, useOverlayRoot } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";

// The open popover's id in the overlay stack, for the content's <OverlayScope>.
const PopoverOverlayId = React.createContext<string | null>(null);

/** Registers in the overlay stack while open, like the cap Popover. */
function Popover({ open, defaultOpen, onOpenChange, ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const root = useOverlayRoot({ open, defaultOpen, onOpenChange });
  return (
    <PopoverOverlayId.Provider value={root.overlayId}>
      <PopoverPrimitive.Root data-slot="popover" open={root.open} onOpenChange={root.onOpenChange} {...props} />
    </PopoverOverlayId.Provider>
  );
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({ className, align = "start", sideOffset = 6, children, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const overlayId = React.useContext(PopoverOverlayId);
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn("z-50 w-72 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md outline-none", className)}
        {...props}
      >
        {overlayId ? <OverlayScope id={overlayId}>{children}</OverlayScope> : children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
