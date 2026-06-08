import { parseISO } from 'date-fns';

export const formatCurrency = (value: number | undefined | null): string => {
  if (value == null) return '₹0';
  return `₹${value.toLocaleString('en-IN')}`;
};

export const safeParseISO = (dateStr: string | undefined | null): Date => {
  if (!dateStr) return new Date(0);
  try {
    const parsed = parseISO(dateStr);
    return isNaN(parsed.getTime()) ? new Date(0) : parsed;
  } catch {
    return new Date(0);
  }
};
