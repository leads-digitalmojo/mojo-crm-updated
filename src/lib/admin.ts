import { db } from './firebase';
import { collection, getDocs, query, limit } from 'firebase/firestore';
import { resetAllTasks } from '../utils/resetTasks';

export const ADMIN_CONFIG = {
    // List of allowed users with their emails and phone numbers (for Wati integration)
    USERS: [
        { name: 'Dhiraj', email: 'dhiraj@digitalmojo.in', phone: '919908398763', isAdmin: true, id: '58Ba96qczERiK7DzBbMkpoko7Vx1' },
        { name: 'Srishti', email: 'srishti@digitalmojo.in', phone: '919899488155', isAdmin: true, id: 'srishti-mojo-id' },
        { name: 'Rupal', email: 'rupal@digitalmojo.in', phone: '919676670777', isAdmin: false, id: 'UNUwlgtVDUc6c9uQVMvBiYjmBYB2' },
        { name: 'Veda', email: 'veda@digitalmojo.in', phone: '919032157788', isAdmin: false, id: '6l7loPF90teRjJxy61ABWH5GUvX2' },
        { name: 'Komal', email: 'komal@digitalmojo.in', phone: '917981245752', isAdmin: false, id: 'OwGcGoDXKdPVAMBNTyrY8nDqpmm2' },
        { name: 'Aditya', email: 'aditya.digitalmojo@gmail.com', phone: '918017699390', isAdmin: true, id: 'aditya-mojo-id' }
    ],

    // Set a hard limit on the number of users who can register
    MAX_USERS: 6,

    // Set this to false to allow any Firebase user to login
    ENFORCE_WHITELIST: true,

    // Set this to false if you don't want to limit user registrations
    ENFORCE_MAX_LIMIT: false,

    // Require location permission for entry
    LOCATION_PERMISSION_REQUIRED: true,
    // Set to true to block access if location is not provided
    LOCATION_PERMISSION_STRICT: false,
};

// Derived lists for compatibility
export const ALLOWED_USERS = ADMIN_CONFIG.USERS.map(u => u.email.toLowerCase());
export const ADMIN_EMAILS = ADMIN_CONFIG.USERS.filter(u => u.isAdmin).map(u => u.email.toLowerCase());
export const AUTHORIZED_PHONES = ADMIN_CONFIG.USERS.map(u => u.phone.replace(/\D/g, ''));

/**
 * Checks if a user is an admin based on their email
 * @param email The email to check
 * @returns boolean indicating if the user is an admin
 */
export const isUserAdmin = (email: string | null | undefined): boolean => {
    if (!email) return false;
    return ADMIN_EMAILS.includes(email.toLowerCase());
};

/**
 * Checks if a user is allowed to log in based on their email
 * @param email The email to check
 * @returns boolean indicating if the user is allowed
 */
export const isUserAllowed = (email: string | null): boolean => {
    if (!email) return false;

    // If whitelist is enforced, check if email is in the list
    if (ADMIN_CONFIG.ENFORCE_WHITELIST) {
        return ALLOWED_USERS.includes(email.toLowerCase());
    }

    return true;
};

/**
 * Checks if more users are allowed to register based on the current user count
 * @returns Promise<boolean> indicating if registration is allowed
 */
export const isRegistrationLimitReached = async (): Promise<boolean> => {
    if (!ADMIN_CONFIG.ENFORCE_MAX_LIMIT) return false;

    try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, limit(ADMIN_CONFIG.MAX_USERS + 1));
        const querySnapshot = await getDocs(q);

        return querySnapshot.size >= ADMIN_CONFIG.MAX_USERS;
    } catch (error) {
        console.error('Error checking user count:', error);
        // If check fails, default to allowing registration but logging the error
        return false;
    }
};

/**
 * Checks if a phone number is authorized (belongs to a registered user)
 * @param phone The phone number to check (cleaned of non-digits)
 * @returns boolean indicating if the phone is authorized
 */
export const isUserPhoneAuthorized = (phone: string): boolean => {
    const cleanPhone = phone.replace(/\D/g, '');
    return AUTHORIZED_PHONES.includes(cleanPhone);
};

// Export the reset tasks utility
export { resetAllTasks };

