'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface CurrencyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: number;
  onChange: (value: number) => void;
  locale?: string;
}

/**
 * Format a number with thousand separators based on locale
 */
function formatNumber(value: number, locale: string): string {
  if (value === 0) return '';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Parse a formatted string back to a number
 */
function parseFormattedNumber(value: string, locale: string): number {
  if (!value) return 0;
  
  // Get the thousand and decimal separators for the locale
  const parts = new Intl.NumberFormat(locale).formatToParts(1234.5);
  const thousandSep = parts.find(p => p.type === 'group')?.value || ',';
  const decimalSep = parts.find(p => p.type === 'decimal')?.value || '.';
  
  // Remove thousand separators and replace decimal separator with '.'
  const normalized = value
    .replace(new RegExp(`\\${thousandSep}`, 'g'), '')
    .replace(decimalSep, '.');
  
  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? 0 : parsed;
}

const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ className, value, onChange, locale = 'en-US', ...props }, ref) => {
    const [displayValue, setDisplayValue] = React.useState<string>(() => 
      formatNumber(value, locale)
    );
    const [isFocused, setIsFocused] = React.useState(false);

    // Update display when value changes externally (not during focus)
    React.useEffect(() => {
      if (!isFocused) {
        setDisplayValue(formatNumber(value, locale));
      }
    }, [value, locale, isFocused]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawValue = e.target.value;
      
      // Allow only numbers, decimal separators, and thousand separators
      const parts = new Intl.NumberFormat(locale).formatToParts(1234.5);
      const decimalSep = parts.find(p => p.type === 'decimal')?.value || '.';
      
      // Build regex to allow only valid characters
      const validChars = new RegExp(`[^0-9\\${decimalSep}]`, 'g');
      const cleanedValue = rawValue.replace(validChars, '');
      
      setDisplayValue(cleanedValue);
      
      const numericValue = parseFormattedNumber(cleanedValue, locale);
      onChange(numericValue);
    };

    const handleFocus = () => {
      setIsFocused(true);
      // On focus, show the raw number for easier editing
      if (value > 0) {
        const parts = new Intl.NumberFormat(locale).formatToParts(1234.5);
        const decimalSep = parts.find(p => p.type === 'decimal')?.value || '.';
        setDisplayValue(value.toString().replace('.', decimalSep));
      }
    };

    const handleBlur = () => {
      setIsFocused(false);
      // On blur, format the number nicely
      const numericValue = parseFormattedNumber(displayValue, locale);
      setDisplayValue(formatNumber(numericValue, locale));
      onChange(numericValue);
    };

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={cn(className)}
        {...props}
      />
    );
  }
);

CurrencyInput.displayName = 'CurrencyInput';

export { CurrencyInput };
