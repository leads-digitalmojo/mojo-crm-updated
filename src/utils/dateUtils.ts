import { Timestamp } from 'firebase/firestore';

/**
 * Safely converts any stored date format (ISO String or Firestore Timestamp) to a Date object.
 * Returns null if the input is invalid.
 */
export const parseSafeDate = (date: any): Date | null => {
    if (!date) return null;
    
    // Handle Firestore Timestamp
    if (date instanceof Timestamp || (date && typeof date === 'object' && 'seconds' in date)) {
        try {
            return new Timestamp(date.seconds, date.nanoseconds).toDate();
        } catch (e) {
            return null;
        }
    }
    
    // Handle ISO String or existing Date
    const parsed = new Date(date);
    return isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Returns a formatted date string for display, handling errors gracefully.
 */
export const formatSafeDate = (date: any, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string => {
    const d = parseSafeDate(date);
    if (!d) return 'N/A';
    return d.toLocaleDateString('en-US', options);
};

/**
 * Returns a numeric value for comparison, handling errors gracefully.
 */
export const getTimeSafe = (date: any): number => {
    const d = parseSafeDate(date);
    return d ? d.getTime() : 0;
};
