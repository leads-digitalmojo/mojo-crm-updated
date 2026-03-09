import { db } from './firebase';
import { collection, getDocs, query, limit } from 'firebase/firestore';
import { resetAllTasks } from '../utils/resetTasks';

export const ADMIN_CONFIG = {
    // List of allowed emails that can log in to the system
    ALLOWED_USERS: [
        'dhiraj@digitalmojo.in',
        'rupal@digitalmojo.in',
        'veda@digitalmojo.in',
        'srishti@digitalmojo.in',
        // Add more allowed emails here
    ],

    // Set a hard limit on the number of users who can register
    MAX_USERS: 5,

    // Set this to false to allow any Firebase user to login
    ENFORCE_WHITELIST: true,

    // Set this to false if you don't want to limit user registrations
    ENFORCE_MAX_LIMIT: false,

    // Require location permission for entry
    LOCATION_PERMISSION_REQUIRED: true
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
        return ADMIN_CONFIG.ALLOWED_USERS.includes(email.toLowerCase());
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

// Export the reset tasks utility
export { resetAllTasks };

