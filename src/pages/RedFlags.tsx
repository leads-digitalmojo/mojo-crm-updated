import React, { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { 
  Flag, 
  Clock, 
  Calendar, 
  User, 
  ExternalLink, 
  RefreshCw, 
  AlertTriangle,
  ChevronRight,
  TrendingDown,
  Users,
  AlertCircle
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ADMIN_CONFIG } from '../lib/admin';

const RED_FLAG_STAGES = ['16', '16.5', '21', '20.5', '20', '19', '18', '17'];

const RedFlags: React.FC = () => {
    const { dashboardStats, fetchDashboardStats, stages, currentUser } = useStore();
    const [isRefreshing, setIsRefreshing] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        if (!dashboardStats) {
            fetchDashboardStats(30);
        }
    }, [dashboardStats, fetchDashboardStats]);

    const handleRefresh = async () => {
        setIsRefreshing(true);
        const refreshToast = toast.loading('Rescanning for red flags...');
        try {
            await fetchDashboardStats(30);
            toast.success('Scan complete!', { id: refreshToast });
        } catch (error) {
            toast.error('Failed to refresh data', { id: refreshToast });
        } finally {
            setIsRefreshing(false);
        }
    };

    const normalizeOwner = (ownerIdOrEmail: string | null | undefined) => {
        if (!ownerIdOrEmail) return 'Unassigned';
        const normalized = ownerIdOrEmail.trim().toLowerCase();
        const user = ADMIN_CONFIG.USERS.find(u => 
            u.id === ownerIdOrEmail || 
            u.email.toLowerCase() === normalized ||
            (u.name && u.name.toLowerCase() === normalized)
        );
        return user ? user.name : ownerIdOrEmail;
    };

    const redFlagData = useMemo(() => {
        if (!dashboardStats?.allOpportunities) return { userGroups: {}, totalLeaks: 0, missingTotal: 0, stagnantTotal: 0 };

        const all = dashboardStats.allOpportunities;
        const userGroups: Record<string, any[]> = {};
        let missingTotal = 0;
        let stagnantTotal = 0;

        all.forEach(opp => {
            if (opp.status !== 'Open') return;

            const owner = opp.owner || opp.followUpAssignee;
            if (!owner || owner.trim() === '') return; // Skip unassigned as per user request
            
            const normalizedName = normalizeOwner(owner);
            const reasons: string[] = [];
            
            // 1. Missing Follow-up Check
            if (RED_FLAG_STAGES.includes(String(opp.stage)) && (!opp.followUpDate || String(opp.followUpDate).trim() === '')) {
                reasons.push('Missing Follow-up Date');
                missingTotal++;
            }

            // 2. Stagnant Lead Check (Stage 16 > 2 hours)
            const isStage16 = String(opp.stage) === '16';
            if (isStage16 && opp.createdAt) {
                const ageMs = Date.now() - new Date(opp.createdAt as any).getTime();
                if (ageMs > 2 * 60 * 60 * 1000) {
                    reasons.push('Stagnant in Yet to Contact (> 2 hrs)');
                    stagnantTotal++;
                }
            }

            if (reasons.length > 0) {
                if (!userGroups[normalizedName]) {
                    userGroups[normalizedName] = [];
                }
                userGroups[normalizedName].push({
                    ...opp,
                    redFlagReasons: reasons
                });
            }
        });

        return { userGroups, totalFlags: missingTotal + stagnantTotal, missingTotal, stagnantTotal };
    }, [dashboardStats]);

    const getStageTitle = (stageId: string) => {
        return stages.find(s => s.id === stageId)?.title || stageId;
    };

    const { userGroups, totalFlags, missingTotal, stagnantTotal } = redFlagData;

    return (
        <div className="h-full bg-gray-50 flex flex-col">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="bg-red-100 p-2 rounded-lg">
                        <Flag className="text-red-600" size={20} />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">Red Flags Dashboard</h1>
                        <p className="text-sm text-gray-500">Monitoring leads that need immediate attention</p>
                    </div>
                </div>
                <button 
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                    <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
                    Re-scan
                </button>
            </header>

            <main className="flex-1 overflow-auto p-6 space-y-6 max-w-7xl mx-auto w-full">
                {/* Stats Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                            <AlertTriangle size={64} className="text-red-600" />
                        </div>
                        <h3 className="text-sm font-medium text-gray-500 mb-1">Total Flags</h3>
                        <div className="text-3xl font-bold text-gray-900 underline decoration-red-500 decoration-4 underline-offset-4">{totalFlags}</div>
                        <div className="mt-4 flex items-center gap-2 text-xs text-red-600 font-semibold bg-red-50 w-fit px-2 py-1 rounded-full">
                           <TrendingDown size={12} /> High Priority
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                            <Calendar size={64} className="text-amber-600" />
                        </div>
                        <h3 className="text-sm font-medium text-gray-500 mb-1">Missing Follow-up</h3>
                        <div className="text-3xl font-bold text-gray-900">{missingTotal}</div>
                        <div className="mt-4 text-xs text-gray-500">Leads in critical stages without next action</div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                            <Clock size={64} className="text-blue-600" />
                        </div>
                        <h3 className="text-sm font-medium text-gray-500 mb-1">Stagnant Leads</h3>
                        <div className="text-3xl font-bold text-gray-900">{stagnantTotal}</div>
                        <div className="mt-4 text-xs text-gray-500">"Yet to Contact" for over 2 hours</div>
                    </div>
                </div>

                {/* Dashboard Sections */}
                <div className="grid grid-cols-1 gap-8">
                    {Object.keys(userGroups).length === 0 ? (
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center">
                            <div className="bg-green-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Flag className="text-green-600" size={32} />
                            </div>
                            <h2 className="text-xl font-bold text-gray-900 mb-2">No Red Flags Detected!</h2>
                            <p className="text-gray-500">All assigned leads are being followed up correctly.</p>
                        </div>
                    ) : (
                        Object.entries(userGroups).map(([userName, leads]) => (
                            <div key={userName} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                                <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-brand-blue/10 flex items-center justify-center text-brand-blue font-bold">
                                            {userName.charAt(0)}
                                        </div>
                                        <div>
                                            <h2 className="font-bold text-gray-900 text-lg">{userName}</h2>
                                            <p className="text-xs text-gray-500">{leads.length} critical leads</p>
                                        </div>
                                    </div>
                                    <span className="bg-red-100 text-red-700 text-xs font-bold px-3 py-1 rounded-full border border-red-200">
                                        Action Required
                                    </span>
                                </div>
                                <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                    {leads.map((lead) => (
                                        <div key={lead.id} className="p-4 bg-gray-50 border border-gray-200 rounded-xl hover:border-brand-blue hover:shadow-md transition-all group flex flex-col justify-between h-full">
                                            <div>
                                                <div className="flex justify-between items-start mb-2">
                                                    <h4 className="font-bold text-gray-900 group-hover:text-brand-blue transition-colors uppercase text-sm">{lead.name}</h4>
                                                    <button 
                                                        onClick={() => navigate(`/opportunities?search=${lead.name}`)}
                                                        className="text-gray-400 hover:text-brand-blue transition-colors"
                                                    >
                                                        <ExternalLink size={14} />
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-2 mb-4">
                                                    <span className="text-[10px] font-bold px-1.5 py-0.5 bg-white border border-gray-200 text-gray-600 rounded">
                                                        {getStageTitle(lead.stage)}
                                                    </span>
                                                </div>
                                                <div className="space-y-2 mb-4">
                                                    {lead.redFlagReasons.map((reason, idx) => (
                                                        <div key={idx} className="flex items-center gap-2 text-xs font-semibold text-red-600 bg-red-50/50 px-2 py-1 rounded">
                                                            <AlertCircle size={12} />
                                                            {reason}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between pt-3 border-t border-gray-100 mt-auto">
                                                <div className="text-[10px] text-gray-400">
                                                    {lead.createdAt && `Added ${formatDistanceToNow(new Date(lead.createdAt as any))} ago`}
                                                </div>
                                                <button 
                                                    onClick={() => navigate(`/opportunities?search=${lead.name}`)}
                                                    className="text-brand-blue text-xs font-bold hover:underline flex items-center gap-1"
                                                >
                                                    Fix <ChevronRight size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </main>
        </div>
    );
};

export default RedFlags;
