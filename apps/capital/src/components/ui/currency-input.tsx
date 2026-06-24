'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatMoneyInput, parseMoneyDigits } from '@/lib/utils/format';

interface CurrencyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: number;
  onChange: (value: number) => void;
  locale?: string;
}

/**
 * Shared money input with an always-on "cents mask": the field is permanently
 * formatted to 2 decimals with locale grouping, and digits fill in from the
 * right as you type (typing "8065636" shows "80.656,36"). Backspace removes the
 * rightmost digit and shifts. Because the displayed value is always derived from
 * the numeric value, it can never hold an unformatted/partial amount.
 *
 * Centralized so every money field in the app behaves identically — callers just
 * pass `value` (a number) and `onChange`.
 */
const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ className, value, onChange, locale = 'pt-BR', ...props }, ref) => {
    const display = value ? formatMoneyInput(value, locale) : '';

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(parseMoneyDigits(e.target.value));
    };

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        className={cn('tabular-nums', className)}
        {...props}
      />
    );
  }
);

CurrencyInput.displayName = 'CurrencyInput';

export { CurrencyInput };
