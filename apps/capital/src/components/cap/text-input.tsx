import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { CONTROL } from "./styles";

export type TextInputProps = Omit<ComponentProps<"input">, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  /** Tabular mono digits, for amounts and dates. */
  mono?: boolean;
  /** Marks the field as failing validation (red border). */
  invalid?: boolean;
};

export function TextInput({ value, onChange, mono, invalid, type = "text", className, ...props }: TextInputProps) {
  return (
    <input
      type={type}
      {...props}
      value={value}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      onChange={(event) => onChange(event.target.value)}
      className={cn(CONTROL, mono && "font-mono tabular-nums", className)}
    />
  );
}
