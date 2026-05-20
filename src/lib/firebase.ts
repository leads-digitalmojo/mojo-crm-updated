import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

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
export const functions = getFunctions(app);
