import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
    apiKey: "AIzaSyDMqtxQfmOgGXm85LhhXjAvFRD5BUQ90V8",
    authDomain: "crm1-76cc4.firebaseapp.com",
    projectId: "crm1-76cc4",
    storageBucket: "crm1-76cc4.firebasestorage.app",
    messagingSenderId: "867270353400",
    appId: "1:867270353400:web:ed075186de29846ae3760d"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// 🔥 Connect to emulators when running on localhost or local IP
const isLocalhost = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.startsWith('192.168.'));

if (isLocalhost) {
    console.log('🔥 Connected to Firebase Emulators - ZERO reads billed!');

    // Connect Firestore to emulator
    connectFirestoreEmulator(db, 'localhost', 8080);

    // Connect Auth to emulator
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
}
