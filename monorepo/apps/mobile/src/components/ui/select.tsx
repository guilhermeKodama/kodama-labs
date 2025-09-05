'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  placeholder?: string;
  className?: string;
}

export function Select({ value, onValueChange, children, placeholder, className }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [selectedValue, setSelectedValue] = useState(value || '');
  const selectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedValue(value || '');
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const handleSelect = (newValue: string) => {
    setSelectedValue(newValue);
    onValueChange?.(newValue);
    setOpen(false);
  };

  return (
    <div ref={selectRef} className={cn("relative", className)}>
      <button
        type="button"
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        )}
        onClick={() => setOpen(!open)}
      >
        <span className={selectedValue ? 'text-foreground' : 'text-muted-foreground'}>
          {selectedValue || placeholder}
        </span>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </button>
      
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-background border border-input rounded-md shadow-md">
          {children}
        </div>
      )}
    </div>
  );
}

interface SelectContentProps {
  children: React.ReactNode;
  className?: string;
}

export function SelectContent({ children, className }: SelectContentProps) {
  return (
    <div className={cn("p-1", className)}>
      {children}
    </div>
  );
}

interface SelectItemProps {
  value: string;
  children: React.ReactNode;
  onSelect?: (value: string) => void;
  className?: string;
}

export function SelectItem({ value, children, onSelect, className }: SelectItemProps) {
  return (
    <button
      type="button"
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
        className
      )}
      onClick={() => onSelect?.(value)}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <Check className="h-4 w-4" />
      </span>
      {children}
    </button>
  );
}

interface SelectTriggerProps {
  children: React.ReactNode;
  className?: string;
}

export function SelectTrigger({ children, className }: SelectTriggerProps) {
  return (
    <div className={cn("", className)}>
      {children}
    </div>
  );
}

interface SelectValueProps {
  placeholder?: string;
  children?: React.ReactNode;
}

export function SelectValue({ placeholder, children }: SelectValueProps) {
  return children || placeholder;
}