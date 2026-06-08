import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Layout from './components/Layout';
import { useStore } from './store/useStore';
import { Toaster, toast, useToasterStore } from 'react-hot-toast';
import { Loader2, X } from 'lucide-react';
import ReminderManager from './components/ReminderManager';
import ErrorBoundary from './components/ErrorBoundary';
import { getTrackingInfo, getLocationPermission } from './utils/tracking';
import { ADMIN_CONFIG, isUserAdmin } from './lib/admin';
import { api } from './services/api';
import { signOut } from 'firebase/auth';
import { auth } from './lib/firebase';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Calendars from './pages/Calendars';
// Contacts page removed from navigation
import Opportunities from './pages/Opportunities';
import Tasks from './pages/Tasks';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import Logs from './pages/Logs';
import RedFlags from './pages/RedFlags';
import CommandCentre from './pages/CommandCentre';
import Webhooks from './pages/Webhooks';

const PrivateRoute = () => {
  const { currentUser, isLoadingAuth } = useStore();

  if (isLoadingAuth) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return currentUser ? <Outlet /> : <Navigate to="/login" replace />;
};

const ToastDismissAll: React.FC = () => {
  const { toasts } = useToasterStore();
  // Only show if there are follow-up toasts (they have IDs starting with 'opp-toast-')
  const hasFollowUpToasts = toasts.some(t => t.id.startsWith('opp-toast-'));

  if (!hasFollowUpToasts) return null;

  return (
    <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[1000] animate-in fade-in slide-in-from-bottom-8 duration-300">
      <button
        onClick={() => toast.dismiss()}
        className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 px-5 py-2.5 rounded-full shadow-2xl hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-all flex items-center gap-2.5 text-sm font-bold ring-4 ring-black/5 group"
      >
        <div className="bg-red-100 dark:bg-red-900/30 p-1 rounded-full group-hover:bg-red-500 group-hover:text-white transition-colors">
          <X size={14} strokeWidth={3} />
        </div>
        Clear All Notifications
      </button>
    </div>
  );
};

const App: React.FC = () => {
  const { fetchNotifications, initializeListeners, initializeAuthListener } = useStore();

  useEffect(() => {
    initializeAuthListener();
    fetchNotifications();
    initializeListeners();
  }, [fetchNotifications, initializeListeners, initializeAuthListener]);

  // Track session entry for already logged-in users
  const { currentUser, isLoadingAuth } = useStore();
  useEffect(() => {
    if (!isLoadingAuth && currentUser) {
      const trackEntry = async () => {
        const sessionKey = `tracked_session_${currentUser.id}_${new Date().toISOString().split('T')[0]}`;
        if (sessionStorage.getItem(sessionKey)) return;

        let permissionStatus: 'granted' | 'denied' | 'prompt' = 'prompt';
        if (ADMIN_CONFIG.LOCATION_PERMISSION_REQUIRED) {
          permissionStatus = await getLocationPermission();
          if (permissionStatus !== 'granted' && ADMIN_CONFIG.LOCATION_PERMISSION_STRICT) {
            await signOut(auth);
            toast.error('Location permission is required. Session revoked.');
            return;
          }
        }

        const trackingData = await getTrackingInfo();
        await api.logs.create({
          userId: currentUser.id,
          userName: currentUser.name,
          userEmail: currentUser.email,
          timestamp: new Date().toISOString(),
          ...trackingData,
          userAgent: navigator.userAgent,
          locationPermission: permissionStatus
        });
        
        sessionStorage.setItem(sessionKey, 'true');
      };

      trackEntry();
    }
  }, [currentUser, isLoadingAuth]);

  return (
    <Router>
      <Toaster position="top-right" />
      <ToastDismissAll />
      <ReminderManager />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route element={<PrivateRoute />}>
          <Route element={<Layout><Outlet /></Layout>}>
            <Route path="/dashboard" element={
              <ErrorBoundary fallbackName="Dashboard">
                <Dashboard />
              </ErrorBoundary>
            } />
            <Route path="/calendars" element={<Calendars />} />
            {/* Contacts routes removed */}
            <Route path="/opportunities" element={
              <ErrorBoundary fallbackName="Opportunities">
                <Opportunities />
              </ErrorBoundary>
            } />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/logs" element={
              isUserAdmin(currentUser?.email) ? <Logs /> : <Navigate to="/dashboard" replace />
            } />
            <Route path="/red-flags" element={
              isUserAdmin(currentUser?.email) ? <RedFlags /> : <Navigate to="/dashboard" replace />
            } />
            <Route path="/command-centre" element={
              <ErrorBoundary fallbackName="Command Centre">
                <CommandCentre />
              </ErrorBoundary>
            } />
            <Route path="/webhooks" element={
              isUserAdmin(currentUser?.email) ? <Webhooks /> : <Navigate to="/dashboard" replace />
            } />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Router>
  );
};

export default App;
