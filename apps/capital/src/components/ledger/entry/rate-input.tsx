"use client";

import { useState } from "react";
import { TextInput, type TextInputProps } from "@/components/cap";
import { rateFieldText } from "@/lib/ledger/entry-form";

export type RateInputProps = Omit<TextInputProps, "placeholder"> & {
  /** The default rate, formatted; shown filled in until the person edits the field. */
  defaultText: string;
};

/**
 * The Câmbio field, prefilled with the current rate like the mockup. The
 * form value stays "" until the person types, so an untouched field keeps
 * meaning "use the default rate"; clearing it shows the default as the
 * placeholder instead of snapping back.
 */
export function RateInput({ value, onChange, defaultText, ...props }: RateInputProps) {
  const [editedFor, setEditedFor] = useState<string | null>(null);
  return (
    <TextInput
      {...props}
      value={rateFieldText(value, defaultText, editedFor)}
      placeholder={defaultText}
      onChange={(next) => {
        setEditedFor(defaultText);
        onChange(next);
      }}
    />
  );
}
