import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { isUserAllowed } from '../lib/admin';
import toast from 'react-hot-toast';
import { Lock, Mail, Loader2 } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { isDemoMode } from '../lib/demoData';
import { getTrackingInfo, getLocationPermission } from '../utils/tracking';
import { api } from '../services/api';
import { ADMIN_CONFIG } from '../lib/admin';

const Login: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();
    const { setCurrentUser, setGoogleToken } = useStore();

    // Auto-login in demo mode
    useEffect(() => {
        if (isDemoMode()) {
            setCurrentUser({
                id: 'demo_user',
                name: 'Demo User',
                email: 'demo@example.com',
                avatar: 'https://ui-avatars.com/api/?name=Demo+User&background=random'
            });
            navigate('/dashboard');
        }
    }, [navigate, setCurrentUser]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();

        // Skip authentication in demo mode
        if (isDemoMode()) {
            setCurrentUser({
                id: 'demo_user',
                name: 'Demo User',
                email: 'demo@example.com',
                avatar: 'https://ui-avatars.com/api/?name=Demo+User&background=random'
            });
            navigate('/dashboard');
            return;
        }

        if (!email || !password) {
            toast.error('Please enter both email and password');
            return;
        }

        setIsLoading(true);
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            if (!isUserAllowed(user.email)) {
                await signOut(auth);
                toast.error('Your email is not authorized to access this CRM.');
                return;
            }

            // Check for location permission if required
            let permissionStatus: 'granted' | 'denied' | 'prompt' = 'prompt';
            if (ADMIN_CONFIG.LOCATION_PERMISSION_REQUIRED) {
                toast.loading('Checking location permission...', { id: 'location-check' });
                permissionStatus = await getLocationPermission();
                toast.dismiss('location-check');

                if (permissionStatus !== 'granted' && ADMIN_CONFIG.LOCATION_PERMISSION_STRICT) {
                    await signOut(auth);
                    toast.error('Location permission is required to access this CRM. Please enable it in your browser settings.');
                    return;
                } else if (permissionStatus !== 'granted') {
                    toast.error('Location not detected, but letting you in. Please check browser settings for better security.', { duration: 5000 });
                }
            }

            // Track login
            const trackingData = await getTrackingInfo();
            await api.logs.create({
                userId: user.uid,
                userName: user.displayName || user.email?.split('@')[0] || 'User',
                userEmail: user.email || '',
                timestamp: new Date().toISOString(),
                ...trackingData,
                userAgent: navigator.userAgent,
                locationPermission: permissionStatus
            });

            toast.success('Logged in successfully');
            navigate('/dashboard');
        } catch (error: any) {
            console.error('Login error:', error);
            let errorMessage = 'Failed to login';
            if (error.code === 'auth/user-not-found') errorMessage = 'User not found';
            if (error.code === 'auth/wrong-password') errorMessage = 'Invalid password';
            if (error.code === 'auth/invalid-email') errorMessage = 'Invalid email address';
            if (error.code === 'auth/too-many-requests') errorMessage = 'Too many failed attempts. Try again later.';
            toast.error(errorMessage);
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        // Skip authentication in demo mode
        if (isDemoMode()) {
            setCurrentUser({
                id: 'demo_user',
                name: 'Demo User',
                email: 'demo@example.com',
                avatar: 'https://ui-avatars.com/api/?name=Demo+User&background=random'
            });
            navigate('/dashboard');
            return;
        }

        try {
            const provider = new GoogleAuthProvider();
            provider.addScope('https://www.googleapis.com/auth/calendar.events');

            const result = await signInWithPopup(auth, provider);

            if (!isUserAllowed(result.user.email)) {
                await signOut(auth);
                toast.error('Your email is not authorized to access this CRM.');
                return;
            }

            // Check for location permission if required
            let permissionStatus: 'granted' | 'denied' | 'prompt' = 'prompt';
            if (ADMIN_CONFIG.LOCATION_PERMISSION_REQUIRED) {
                toast.loading('Checking location permission...', { id: 'location-check' });
                permissionStatus = await getLocationPermission();
                toast.dismiss('location-check');

                if (permissionStatus !== 'granted' && ADMIN_CONFIG.LOCATION_PERMISSION_STRICT) {
                    await signOut(auth);
                    toast.error('Location permission is required to access this CRM. Please enable it in your browser settings.');
                    return;
                } else if (permissionStatus !== 'granted') {
                    toast.error('Location not detected, but letting you in.', { duration: 5000 });
                }
            }

            // Track login
            const trackingData = await getTrackingInfo();
            await api.logs.create({
                userId: result.user.uid,
                userName: result.user.displayName || result.user.email?.split('@')[0] || 'User',
                userEmail: result.user.email || '',
                timestamp: new Date().toISOString(),
                ...trackingData,
                userAgent: navigator.userAgent,
                locationPermission: permissionStatus
            });

            const credential = GoogleAuthProvider.credentialFromResult(result);
            const token = credential?.accessToken;

            if (token) {
                setGoogleToken(token);
            }

            toast.success('Logged in successfully');
            navigate('/dashboard');
        } catch (error: any) {
            console.error('Google login error:', error);
            toast.error('Failed to login with Google');
        }
    };

    // Don't show login form in demo mode (will auto-redirect)
    if (isDemoMode()) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <div className="flex justify-center">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center">
                        <img src="/dm.png" alt="Logo" className="h-14 w-14" />
                    </div>
                </div>
                <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
                    Sign in to your account
                </h2>

            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
                    <form className="space-y-6" onSubmit={handleLogin}>
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                                Email address
                            </label>
                            <div className="mt-1 relative rounded-md shadow-sm">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Mail className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                    id="email"
                                    name="email"
                                    type="email"
                                    autoComplete="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="focus:ring-primary focus:border-primary block w-full pl-10 sm:text-sm border-gray-300 rounded-md py-2"
                                    placeholder="you@example.com"
                                />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                                Password
                            </label>
                            <div className="mt-1 relative rounded-md shadow-sm">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Lock className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                    id="password"
                                    name="password"
                                    type="password"
                                    autoComplete="current-password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="focus:ring-primary focus:border-primary block w-full pl-10 sm:text-sm border-gray-300 rounded-md py-2"
                                    placeholder="••••••••"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="flex items-center">
                                <input
                                    id="remember-me"
                                    name="remember-me"
                                    type="checkbox"
                                    className="h-4 w-4 text-brand-blue focus:ring-primary border-gray-300 rounded"
                                />
                                <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-900">
                                    Remember me
                                </label>
                            </div>

                            <div className="text-sm">
                                <a href="#" className="font-medium text-brand-blue hover:text-brand-blue/90">
                                    Forgot your password?
                                </a>
                            </div>
                        </div>

                        <div>
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-black bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isLoading ? (
                                    <Loader2 className="animate-spin h-5 w-5" />
                                ) : (
                                    'Sign in'
                                )}
                            </button>
                        </div>
                    </form>

                    <div className="mt-6">
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-gray-300" />
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-2 bg-white text-gray-500">Or continue with</span>
                            </div>
                        </div>

                        <div className="mt-6 grid grid-cols-2 gap-3">
                            <div>
                                <button
                                    type="button"
                                    onClick={handleGoogleLogin}
                                    disabled={isLoading}
                                    className="w-full inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <span className="sr-only">Sign in with Google</span>
                                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 0.307 5.387 0 12s5.56 12 12.48 12c3.6 0 6.347-1.173 8.547-3.413C23.213 18.107 24 15.4 24 12.853c0-.853-.093-1.707-.267-2.56h-11.253z" />
                                    </svg>
                                </button>
                            </div>

                            <div>
                                <a
                                    href="#"
                                    className="w-full inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-500 hover:bg-gray-50"
                                >
                                    <span className="sr-only">Sign in with GitHub</span>
                                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                                        <path fillRule="evenodd" d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0110 4.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0020 10.017C20 4.484 15.522 0 10 0z" clipRule="evenodd" />
                                    </svg>
                                </a>
                            </div>
                        </div>
                    </div>


                </div>
            </div>
        </div>
    );
};

export default Login;
