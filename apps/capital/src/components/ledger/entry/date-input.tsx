"use client";

import { useState } from "react";
import { TextInput } from "@/components/cap";
import { useFmt } from "@/lib/format/provider";
import { dateInputValue, parseDateText } from "@/lib/ledger/entry-form";

/**
 * The form's Data field: shows the date in the user's format
 * ("22/09/2026") and accepts it typed the same way, also without the year.
 * The value (YYYY-MM-DD) follows the text: a real date, or "" while the
 * text is empty or not a date, so the form's validation blocks Salvar on
 * this field instead of keeping the previous date unseen.
 */
export function DateInput({
  value,
  onChange,
  today,
  invalid,
  disabled,
  id,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  today: string;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const fmt = useFmt();
  const shown = value ? fmt.dateFull(value) : "";
  const [text, setText] = useState(shown);
  const [synced, setSynced] = useState(value);
  // The value changed from outside (quick add, "Criar outra"): show it.
  if (synced !== value) {
    setSynced(value);
    setText(shown);
  }
  const parsed = parseDateText(text, fmt.prefs.dateFormat, today);
  return (
    <TextInput
      id={id}
      value={text}
      disabled={disabled}
      invalid={invalid || !parsed}
      onChange={(next) => {
        setText(next);
        const iso = dateInputValue(next, fmt.prefs.dateFormat, today);
        if (iso !== value) {
          setSynced(iso);
          onChange(iso);
        }
      }}
      onBlur={() => {
        if (parsed) setText(fmt.dateFull(parsed));
      }}
      className={className}
    />
  );
}
