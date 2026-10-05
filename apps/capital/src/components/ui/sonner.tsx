"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { TOAST_CLASS_NAMES } from "@/components/cap/toast-pill"

/**
 * App toaster: the mockup's inverted pill at the bottom center (see
 * TOAST_CLASS_NAMES). Pass `action: { label: "Desfazer", onClick }` for
 * the underlined undo link.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="bottom-center"
      offset={16}
      mobileOffset={16}
      gap={8}
      className="toaster group"
      style={{ "--width": "560px" } as React.CSSProperties}
      toastOptions={{ unstyled: true, classNames: TOAST_CLASS_NAMES }}
      {...props}
    />
  )
}

export { Toaster }
