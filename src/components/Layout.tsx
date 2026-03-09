import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  LayoutDashboard,
  CalendarDays,
  Target,
  ChevronDown,
  CheckSquare,
  X,
  LogOut,
  User as UserIcon,
  Settings,
  Menu,
  Bell,
  Clock,
  ArrowRight,
  Activity
} from 'lucide-react';
import { useStore } from '../store/useStore';
import CommandPalette from './CommandPalette';
import DemoBanner from './DemoBanner';
import { api } from '../services/api';
import { Opportunity } from '../types';
import toast from 'react-hot-toast';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { contacts, opportunities, appointments, currentUser, logout, updateOpportunity } = useStore();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isRemindersOpen, setIsRemindersOpen] = useState(false);
  const [todayOpportunities, setTodayOpportunities] = useState<Opportunity[]>([]);
  const profileRef = useRef<HTMLDivElement>(null);
  const remindersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
      if (remindersRef.current && !remindersRef.current.contains(event.target as Node)) {
        setIsRemindersOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Fetch opportunities with today's follow-up date
  useEffect(() => {
    if (!currentUser) return;

    const fetchTodayFollowUps = async () => {
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      try {
        const opps = await api.opportunities.getByFollowUpDate(todayStr);
        setTodayOpportunities(opps);
      } catch (error) {
        console.error("Error fetching today's follow-ups:", error);
      }
    };

    fetchTodayFollowUps();
    // Refresh every 5 minutes to catch any new follow-ups
    const refreshInterval = setInterval(fetchTodayFollowUps, 5 * 60 * 1000);

    return () => clearInterval(refreshInterval);
  }, [currentUser]);

  const pendingTasksCount = useMemo(() => {
    let count = 0;
    opportunities.forEach(opp => {
      if (opp.tasks) {
        opp.tasks.forEach(task => {
          const isAssignedToMe = task.assignee === currentUser?.id || task.assignee === currentUser?.email;
          if (!task.isCompleted && isAssignedToMe) {
            count++;
          }
        });
      }
    });
    return count;
  }, [opportunities, currentUser]);


  const todayReminders = useMemo(() => {
    return todayOpportunities.filter(opp => {
      const isAssignedToMe = opp.followUpAssignee &&
        (opp.followUpAssignee === currentUser?.id ||
          opp.followUpAssignee === currentUser?.email);
      return opp.status === 'Open' && isAssignedToMe;
    }).map(opp => ({
      id: opp.id,
      type: 'follow-up' as const,
      title: opp.companyName || opp.name,
      time: 'Today',
      description: 'Opportunity follow-up'
    }));
  }, [todayOpportunities, currentUser]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/calendars', icon: CalendarDays, label: 'Calendars' },
    { path: '/opportunities', icon: Target, label: 'Opportunities' },
    { path: '/tasks', icon: CheckSquare, label: 'Tasks' },
    { path: '/logs', icon: Activity, label: 'Logs' },
    { path: '/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="flex h-screen w-full bg-background-light dark:bg-background-dark overflow-hidden transition-colors duration-200">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden backdrop-blur-sm"
          onClick={() => setIsSidebarOpen(false)}
        ></div>
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-52 flex-col bg-[#1e2a3b] text-white transition-transform duration-300 md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-14 items-center gap-2 px-4 border-b border-white/5">
          <img src="/dm.png" alt="Digital Mojo Logo" className="h-7 w-7 object-contain" />
          <h1 className="text-base font-bold tracking-tight text-white">Digital-Mojo</h1>
          <button onClick={() => setIsSidebarOpen(false)} className="md:hidden ml-auto text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 flex flex-col gap-0.5 p-3 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setIsSidebarOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-200 ${isActive
                  ? 'bg-primary text-black font-semibold'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
                  }`}
              >
                <Icon size={18} strokeWidth={isActive ? 2 : 1.5} className={isActive ? 'text-white' : ''} />
                <span className={`font-medium ${isActive ? 'text-black' : 'text-white'}`}>
                  {item.label}
                </span>
                {item.path === '/tasks' && pendingTasksCount > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                    {pendingTasksCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Wrapper */}
      <div className="flex flex-1 flex-col h-full overflow-hidden">
        {/* Demo Banner */}
        <DemoBanner />
        {/* Top Header */}
        <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white dark:bg-gray-800 dark:border-gray-700 px-4 md:px-8 transition-colors duration-200">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              <Menu size={24} />
            </button>
            <div className="flex items-center gap-3 text-gray-800 dark:text-gray-200">
              <div className="hidden md:block p-1.5 bg-gray-100 dark:bg-gray-700 rounded-md">
                <Target className="text-gray-600 dark:text-gray-300" size={20} />
              </div>
              <h2 className="text-sm md:text-base font-bold text-gray-700 dark:text-gray-200 truncate max-w-[200px] md:max-w-none">Digital Mojo · Hyderabad</h2>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            {/* Reminders Dropdown */}
            <div className="relative" ref={remindersRef}>
              {(() => {
                const unreadCount = todayReminders.filter(r => !todayOpportunities.find(o => o.id === r.id)?.followUpRead).length;
                const hasUnread = unreadCount > 0;

                return (
                  <button
                    onClick={() => setIsRemindersOpen(!isRemindersOpen)}
                    className={`p-2 rounded-full transition-all relative ${isRemindersOpen ? 'bg-blue-50 text-brand-blue' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                  >
                    <Bell
                      size={20}
                      className={`${hasUnread ? 'text-red-500 fill-red-500 animate-ring' : ''}`}
                    />
                    {hasUnread && (
                      <span className="absolute top-1 right-1 w-4 h-4 bg-red-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white dark:border-gray-800 shadow-sm animate-pulse">
                        {unreadCount}
                      </span>
                    )}
                  </button>
                );
              })()}

              {isRemindersOpen && (
                <div className="absolute right-0 mt-3 w-80 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
                  <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 flex justify-between items-center">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white">Today's Reminders</h3>
                    <span className="text-[10px] font-bold py-0.5 px-2 bg-blue-100 text-blue-700 rounded-full">{todayReminders.filter(r => !todayOpportunities.find(o => o.id === r.id)?.followUpRead).length} New</span>
                  </div>
                  <div className="max-h-[350px] overflow-y-auto">
                    {todayReminders.length === 0 ? (
                      <div className="p-8 text-center">
                        <div className="w-12 h-12 bg-gray-50 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-3">
                          <Bell size={24} className="text-gray-300" />
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">All caught up! No reminders for today.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-50 dark:divide-gray-700">
                        {todayReminders.map((reminder) => {
                          const isRead = todayOpportunities.find(o => o.id === reminder.id)?.followUpRead;

                          return (
                            <div
                              key={`${reminder.type}-${reminder.id}`}
                              className={`px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer group relative ${isRead ? 'opacity-50' : ''}`}
                              onClick={() => {
                                if (reminder.type === 'follow-up') {
                                  navigate('/opportunities');
                                } else {
                                  navigate('/calendars');
                                }
                                setIsRemindersOpen(false);
                              }}
                            >
                              <div className="flex gap-3 pr-8">
                                <div className={`mt-1 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${reminder.type === 'follow-up' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'}`}>
                                  {reminder.type === 'follow-up' ? <Target size={16} /> : <CalendarDays size={16} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex justify-between items-start mb-0.5">
                                    <p className={`text-sm font-bold text-gray-900 dark:text-white truncate pr-2 ${isRead ? 'line-through' : ''}`}>
                                      {reminder.title}
                                    </p>
                                    <span className="text-[10px] text-gray-400 whitespace-nowrap flex items-center gap-1 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                                      <Clock size={10} />
                                      {reminder.time}
                                    </span>
                                  </div>
                                  <p className={`text-xs text-gray-500 dark:text-gray-400 truncate ${isRead ? 'line-through' : ''}`}>
                                    {reminder.description}
                                  </p>
                                </div>
                              </div>
                              {reminder.type === 'follow-up' && !isRead && (
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      await updateOpportunity(reminder.id, { followUpRead: true });
                                      // We keep it in the dropdown but update the local state for visual feedback
                                      setTodayOpportunities(prev => prev.map(o => o.id === reminder.id ? { ...o, followUpRead: true } : o));
                                      toast.dismiss(`opp-toast-${reminder.id}`);
                                      toast.success('Marked as read', { position: 'bottom-center' });
                                    } catch (error) {
                                      console.error("Error marking as read:", error);
                                    }
                                  }}
                                  className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-900 dark:text-gray-500 dark:hover:text-gray-100 rounded-full transition-all"
                                  title="Mark as Read"
                                >
                                  <div className="w-5 h-5 border-2 border-current rounded-md flex items-center justify-center">
                                    {/* Empty square as requested (remove tick) */}
                                  </div>
                                </button>
                              )}
                              {isRead && (
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-green-500">
                                  <CheckSquare size={18} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="relative" ref={profileRef}>
              <div
                className="flex items-center gap-2 pl-2 border-l border-gray-200 dark:border-gray-700 cursor-pointer"
                onClick={() => setIsProfileOpen(!isProfileOpen)}
              >
                <img
                  className="h-8 w-8 md:h-9 md:w-9 rounded-full object-cover border border-gray-200 dark:border-gray-600"
                  src={currentUser?.avatar || "https://ui-avatars.com/api/?name=User&background=random"}
                  alt="User avatar"
                />
                <ChevronDown size={16} className="text-gray-400 hidden md:block" />
              </div>

              {/* Profile Dropdown */}
              {isProfileOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 animate-in fade-in zoom-in duration-200">
                  <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{currentUser?.name || 'User'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{currentUser?.email || 'user@example.com'}</p>
                  </div>
                  <button
                    onClick={() => {
                      navigate('/profile');
                      setIsProfileOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    <UserIcon size={16} />
                    Profile
                  </button>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                  >
                    <LogOut size={16} />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto bg-background-light dark:bg-background-dark transition-colors duration-200 pb-20 md:pb-0">
          {children}
        </main>

        {/* Mobile Bottom Navigation */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 h-16 flex items-center justify-around px-2 z-50 pb-safe">
          {navItems.filter(item => item.label !== 'Calendars').map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors ${isActive
                  ? 'text-brand-orange'
                  : 'text-gray-500 dark:text-gray-400'
                  }`}
              >
                <div className="relative">
                  <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                  {item.path === '/tasks' && pendingTasksCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold px-1 rounded-full min-w-[14px] h-3.5 flex items-center justify-center">
                      {pendingTasksCount}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
      <CommandPalette />
    </div>
  );
};

export default Layout;