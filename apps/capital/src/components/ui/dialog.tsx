"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { OverlayScope, useOverlayRoot } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";

// The open dialog's id in the overlay stack, for the content's <OverlayScope>.
const DialogOverlayId = React.createContext<string | null>(null);

/** Registers in the overlay stack while open, like the cap Dialog: app shortcuts pause and Esc closes only the top layer. */
function Dialog({ open, defaultOpen, onOpenChange, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const root = useOverlayRoot({ open, defaultOpen, onOpenChange });
  return (
    <DialogOverlayId.Provider value={root.overlayId}>
      <DialogPrimitive.Root data-slot="dialog" open={root.open} onOpenChange={root.onOpenChange} {...props} />
    </DialogOverlayId.Provider>
  );
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay data-slot="dialog-overlay" className={cn("fixed inset-0 z-50 bg-scrim/50", className)} {...props} />;
}

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const overlayId = React.useContext(DialogOverlayId);
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-background p-6 shadow-lg",
          className,
        )}
        {...props}
      >
        {overlayId ? <OverlayScope id={overlayId}>{children}</OverlayScope> : children}
        <DialogPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 hover:opacity-100">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn("text-lg font-semibold", className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription };
