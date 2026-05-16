import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export type AppLocale = "pt-BR" | "en";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCnpj(cnpj: string): string {
  const digits = cnpj.replace(/\D/g, "");
  return digits.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5"
  );
}

export function formatCurrency(value: number | string, locale: AppLocale = "pt-BR"): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "BRL",
  }).format(num);
}

export function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function formatPercent(value: number, locale: AppLocale = "pt-BR"): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value / 100);
}

export function formatNumber(value: number, locale: AppLocale = "pt-BR"): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatDate(date: Date | string, locale: AppLocale = "pt-BR"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(locale);
}

export function formatDateTime(date: Date | string, locale: AppLocale = "pt-BR"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(locale) + (locale === "pt-BR" ? " às " : " at ") +
    d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

export function formatTime(date: Date | string, locale: AppLocale = "pt-BR"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}
