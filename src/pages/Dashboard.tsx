import React, { useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { TrendingUp, Target, CheckCircle, Loader2, Users, ArrowUpRight, ArrowDownRight, CircleDollarSign, Flag } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { useStore } from '../store/useStore';
import { isUserAdmin, ADMIN_CONFIG } from '../lib/admin';
import { collection, getDocs } from 'firebase/firestore';
import { functions, db } from '../lib/firebase';
import toast from 'react-hot-toast';

const Dashboard: React.FC = () => {
  const { dashboardStats, fetchDashboardStats, stages, currentUser } = useStore();
  const [timeRange, setTimeRange] = React.useState('30'); // '30', '7', '1'
  const [isSendingReport, setIsSendingReport] = React.useState(false);
  const [employeeMetrics, setEmployeeMetrics] = React.useState<Record<string, number>>({});

  // Fetch employee metrics (escalations)
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'employee_metrics'));
        const metricsData: Record<string, number> = {};
        snapshot.forEach(doc => {
          metricsData[doc.id] = doc.data().escalationCount || 0;
        });
        setEmployeeMetrics(metricsData);
      } catch (err) {
        console.error('Error fetching employee metrics:', err);
      }
    };
    
    if (isUserAdmin(currentUser?.email)) {
      fetchMetrics();
    }
  }, [currentUser]);

  // Fetch dashboard stats when time range changes
  useEffect(() => {
    fetchDashboardStats(parseInt(timeRange));
  }, [fetchDashboardStats, timeRange]);

  const handleSendRedFlagReport = async () => {
    if (isSendingReport) return;
    
    setIsSendingReport(true);
    const sendReport = httpsCallable(functions, 'sendRedFlagReport');
    
    try {
      await toast.promise(
        sendReport(),
        {
          loading: 'Generating and sending red flag report...',
          success: 'Red flag report sent to Dhiraj successfully!',
          error: (err) => `Failed to send report: ${err.message || 'Unknown error'}`
        }
      );
    } catch (error) {
      console.error('Error triggering red flag report:', error);
    } finally {
      setIsSendingReport(false);
    }
  };

  // Dashboard stats and stages logic continues below... (Hooks must come first)

  // Funnel Data: Sort stages logically (Start -> End)
  const funnelData = React.useMemo(() => {
    const stageOrder = ['16', '16.5', 'not responding', '21', '20.5', '20', '19', '18', '17', '10', '0', '0.5'];

    return stageOrder.map(id => {
      const stage = (stages || []).find(s => s.id === id);
      if (!stage) return null;
      const stageData = dashboardStats?.stageBreakdown?.[id];
      
      const title = stage.title || 'Unknown Stage';
      const shortName = title.includes(' - ') ? title.split(' - ')[1] : title;

      return {
        name: shortName,
        fullName: title,
        value: stageData?.count || 0,
        fill: stage.color || '#cbd5e1'
      };
    }).filter(Boolean) as any[];
  }, [stages, dashboardStats]);

  // Task Data
  const taskData = React.useMemo(() => {
    if (!dashboardStats?.taskStats || dashboardStats.taskStats.total === 0) return [];
    return [
      { name: 'Completed', value: dashboardStats.taskStats.completed || 0 },
      { name: 'Pending', value: dashboardStats.taskStats.pending || 0 }
    ];
  }, [dashboardStats]);

  const taskColors = ['#1ea34f', '#eb7311'];

  // Individual Performance Stats and Call Aggregates
  const { teamMemberStats, globalCallStats } = React.useMemo(() => {
    if (!dashboardStats?.recentOpportunities) return { teamMemberStats: [], globalCallStats: { totalDuration: 0, totalCount: 0 } };

    const TEAM_MEMBERS = ADMIN_CONFIG.USERS;
    const stagesList = stages || [];

    const stats: Record<string, { 
      name: string, 
      total: number, 
      won: number, 
      lost: number, 
      open: number,
      value: number,
      totalCallDuration: number,
      totalCalls: number,
      stageCounts: Record<string, number>
    }> = {};
    
    let globalDuration = 0;
    let globalCount = 0;

    // Initialize stats for known team members
    TEAM_MEMBERS.forEach(m => {
      stats[m.email] = { name: m.name, total: 0, won: 0, lost: 0, open: 0, value: 0, totalCallDuration: 0, totalCalls: 0, stageCounts: {} };
    });

    // 1. Calculate Opportunity generation metrics using recentOpportunities
    (dashboardStats.recentOpportunities || []).forEach(opp => {
      if (!opp) return; 
      const assigneeRaw = opp.followUpAssignee || opp.owner || 'Unassigned';
      
      const member = TEAM_MEMBERS.find(m => 
        m.id === assigneeRaw || 
        m.email === assigneeRaw || 
        m.email.toLowerCase() === assigneeRaw.toLowerCase() ||
        m.name.toLowerCase() === assigneeRaw.toLowerCase()
      );
      
      const key = member ? member.email : (assigneeRaw === 'Unassigned' ? 'Unassigned' : assigneeRaw);
      
      if (!stats[key]) {
        stats[key] = { name: key === 'Unassigned' ? 'Unassigned' : (member?.name || key), total: 0, won: 0, lost: 0, open: 0, value: 0, totalCallDuration: 0, totalCalls: 0, stageCounts: {} };
      }
      
      stats[key].total++;
      
      const stageId = opp.stage || 'unknown';
      stats[key].stageCounts[stageId] = (stats[key].stageCounts[stageId] || 0) + 1;

      if (opp.status === 'Won' || opp.stage === '10') {
        stats[key].won++;
      } else if (opp.status === 'Lost' || opp.status === 'Abandoned') {
        stats[key].lost++;
      } else {
        stats[key].open++;
      }
      
      const val = Number(opp.value);
      stats[key].value += isNaN(val) ? 0 : val;
    });

    // 2. Calculate Call metrics using allOpportunities to ensure calls on older leads are counted
    let pastDateStr: string | null = null;
    if (timeRange !== 'all') {
      const daysBack = parseInt(timeRange);
      if (daysBack > 0) {
        const pastDate = new Date();
        pastDate.setDate(new Date().getDate() - (daysBack - 1));
        pastDate.setHours(0, 0, 0, 0);
        pastDateStr = pastDate.toISOString();
      }
    }

    (dashboardStats.allOpportunities || []).forEach(opp => {
      if (!opp || !Array.isArray(opp.calls)) return;
      
      const assigneeRaw = opp.followUpAssignee || opp.owner || 'Unassigned';
      const defaultMember = TEAM_MEMBERS.find(m => 
        m.id === assigneeRaw || m.email === assigneeRaw || m.email.toLowerCase() === assigneeRaw.toLowerCase() || m.name.toLowerCase() === assigneeRaw.toLowerCase()
      );
      const defaultKey = defaultMember ? defaultMember.email : (assigneeRaw === 'Unassigned' ? 'Unassigned' : assigneeRaw);

      opp.calls.forEach(call => {
        // Filter out calls that are older than the selected time range
        if (pastDateStr && call.startTime && call.startTime < pastDateStr) return;

        const dur = (call.duration || 0);
        const callerName = (call.userName || '').toLowerCase();
        
        // Find the team member who made the call
        const callerMember = TEAM_MEMBERS.find(m => 
          m.name.toLowerCase() === callerName ||
          m.email.toLowerCase() === callerName ||
          (callerName && m.name.toLowerCase().includes(callerName)) ||
          (callerName && callerName.includes(m.name.toLowerCase()))
        );
        
        const callKey = callerMember ? callerMember.email : defaultKey;
        
        if (!stats[callKey]) {
          stats[callKey] = { 
            name: callerMember?.name || call.userName || callKey, 
            total: 0, won: 0, lost: 0, open: 0, value: 0, 
            totalCallDuration: 0, totalCalls: 0, stageCounts: {} 
          };
        }
        
        stats[callKey].totalCallDuration += dur;
        stats[callKey].totalCalls++;
        globalDuration += dur;
        globalCount++;
      });
    });

    const memberStats = Object.values(stats).map(entry => {
      const rate = entry.total > 0 ? (entry.won / entry.total) * 100 : 0;
      return {
        ...entry,
        rate: isNaN(rate) ? 0 : Number(rate.toFixed(1)),
        value: isNaN(entry.value) ? 0 : entry.value,
        total: isNaN(entry.total) ? 0 : entry.total,
        won: isNaN(entry.won) ? 0 : entry.won,
        lost: isNaN(entry.lost) ? 0 : entry.lost,
        open: isNaN(entry.open) ? 0 : entry.open
      };
    }).sort((a, b) => b.total - a.total);

    return { teamMemberStats: memberStats, globalCallStats: { totalDuration: globalDuration, totalCount: globalCount } };
  }, [dashboardStats, stages, timeRange]);

  // Safe Icon Picker
  const IndianRupeeIcon = (LucideIcons as any).IndianRupee || CircleDollarSign;

  // Loading state: Wait for both stats and stages to ensure charts have labels
  const isDataReady = !!dashboardStats && stages && stages.length > 0;

  if (!isDataReady) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-brand-blue" />
          <p className="text-gray-500 font-medium">Preparing your analytics...</p>
          <p className="text-xs text-gray-400">Syncing CRM data and pipeline stages</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8 bg-gray-50/50 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-3xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex items-center gap-3">
          {isUserAdmin(currentUser?.email) && (
            <button
              onClick={handleSendRedFlagReport}
              disabled={isSendingReport}
              className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 border border-red-100 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold"
              title="Send critical lead stagnation report to Dhiraj"
            >
              {isSendingReport ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Flag size={16} />
              )}
              <span>Red Flag Report</span>
            </button>
          )}
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="bg-white border border-gray-300 text-gray-700 text-sm rounded-lg focus:ring-primary focus:border-primary block p-2.5"
          >
            <option value="0">Total</option>
            <option value="30">Last 30 Days</option>
            <option value="7">Last 7 Days</option>
            <option value="1">Today</option>
          </select>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
        {[
          {
            label: 'Opportunities',
            value: (dashboardStats?.totalOpportunities || 0).toString(),
            subtext: `${dashboardStats?.openOpportunities || 0} Open`,
            icon: Target,
            color: 'text-brand-blue',
            bgColor: 'bg-brand-blue/10'
          },
          {
            label: 'Pipeline Value',
            value: `₹${(dashboardStats?.totalPipelineValue || 0).toLocaleString()}`,
            subtext: 'Total value',
            icon: IndianRupeeIcon,
            color: 'text-brand-green',
            bgColor: 'bg-brand-green/10'
          },
          {
            label: 'Conversion Rate',
            value: `${(dashboardStats?.conversionRate || 0).toFixed(1)}%`,
            subtext: 'Won / Total',
            icon: TrendingUp,
            color: 'text-brand-purple',
            bgColor: 'bg-brand-purple/10'
          },
          {
            label: 'Closed Won',
            value: (dashboardStats?.wonOpportunities || 0).toString(),
            subtext: `${dashboardStats?.lostOpportunities || 0} Lost`,
            icon: CheckCircle,
            color: 'text-brand-green',
            bgColor: 'bg-brand-green/10'
          },
          {
            label: 'Call Analytics',
            value: `${Math.floor(globalCallStats.totalDuration / 3600)}h ${Math.floor((globalCallStats.totalDuration % 3600) / 60)}m`,
            subtext: `${globalCallStats.totalCount} calls recorded`,
            icon: LucideIcons.PhoneIncoming,
            color: 'text-orange-600',
            bgColor: 'bg-orange-50'
          },
        ].map((stat, idx) => (
          <div key={idx} className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-medium text-gray-500">{stat.label}</p>
                <h3 className="text-3xl font-bold text-gray-900 mt-2">{stat.value}</h3>
                <p className="text-xs text-gray-400 mt-1">{stat.subtext}</p>
              </div>
              <div className={`p-3 ${stat.bgColor} rounded-lg ${stat.color}`}>
                {stat.icon && <stat.icon size={24} />}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Charts Area - Now Full Width */}
        <div className="lg:col-span-3 space-y-8">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            {/* Funnel */}
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
              <h3 className="text-lg font-bold text-gray-900 mb-6">Lead Conversion Funnel</h3>
              <div className="h-96">
                {funnelData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={funnelData} margin={{ top: 20, right: 30, left: 20, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="name"
                        angle={-45}
                        textAnchor="end"
                        interval={0}
                        height={60}
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip
                        cursor={{ fill: 'transparent' }}
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="bg-white p-2 border border-gray-200 shadow-lg rounded">
                                <p className="font-bold">{data.fullName}</p>
                                <p className="text-sm">Count: {data.value}</p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {funnelData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-400">No data available</div>
                )}
              </div>
            </div>

            {/* Pipeline Trend */}
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
              <h3 className="text-lg font-bold text-gray-900 mb-6">Pipeline Value Trend</h3>
              <div className="h-96">
                {(dashboardStats?.pipelineTrend || []).length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dashboardStats?.pipelineTrend}>
                      <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#1ea34f" stopOpacity={0.1} />
                          <stop offset="95%" stopColor="#1ea34f" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} />
                      <Tooltip
                        formatter={(value: number) => [`₹${(value || 0).toLocaleString()}`, 'Pipeline Value']}
                      />
                      <Area type="monotone" dataKey="value" stroke="#1ea34f" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-400">No trend data available</div>
                )}
              </div>
            </div>
          </div>

          {/* Wide Chart / Task Breakdown */}
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row items-center justify-around">
            <div className="w-full md:w-1/2">
              <h3 className="text-lg font-bold text-gray-900 mb-2">Task Distribution</h3>
              <p className="text-sm text-gray-500 mb-6">Overview of team activity status.</p>
              <div className="space-y-3">
                {taskData.length > 0 ? taskData.map((task, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: taskColors[i] }}></div>
                      <span className="text-sm font-medium text-gray-700">{task.name}</span>
                    </div>
                    <span className="text-sm font-bold text-gray-900">{task.value}</span>
                  </div>
                )) : <p className="text-sm text-gray-400">No tasks found.</p>}
              </div>
            </div>
            <div className="w-full md:w-1/2 h-64 flex items-center justify-center">
              {taskData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={taskData}
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {taskData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={taskColors[index % taskColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-gray-400">No data</div>
              )}
            </div>
          </div>

          {/* Admin Visualization Section */}
          {isUserAdmin(currentUser?.email) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Pipeline Value by Team Member */}
              <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Pipeline Value by Member</h3>
                    <p className="text-sm text-gray-500">Total lead value assigned to each employee.</p>
                  </div>
                  <div className="p-2 bg-brand-blue/10 rounded-lg">
                    {IndianRupeeIcon && <IndianRupeeIcon className="text-brand-blue" size={20} />}
                  </div>
                </div>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={teamMemberStats} margin={{ top: 10, right: 10, left: -10, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                      <XAxis 
                        dataKey="name" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 11, fill: '#6b7280' }}
                        interval={0}
                        angle={-20}
                        textAnchor="end"
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 11, fill: '#6b7280' }}
                        tickFormatter={(value) => `₹${value >= 1000 ? (value / 1000).toFixed(0) + 'k' : value}`}
                      />
                      <Tooltip 
                        formatter={(value: number) => [`₹${value.toLocaleString()}`, 'Total Pipeline Value']}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                        cursor={{ fill: '#f9fafb' }}
                      />
                      <Bar dataKey="value" fill="#2563eb" radius={[6, 6, 0, 0]} barSize={32} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Conversion Rate by Member */}
              <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Conversion Success Rate</h3>
                    <p className="text-sm text-gray-500">Won leads percentage per member.</p>
                  </div>
                  <div className="p-2 bg-green-50 rounded-lg">
                    <Target className="text-green-600" size={20} />
                  </div>
                </div>
                <div className="h-[280px]">
                   <ResponsiveContainer width="100%" height="100%">
                    <BarChart 
                      data={teamMemberStats.map(u => ({
                        name: u.name,
                        rate: u.total > 0 ? parseFloat(((u.won / u.total) * 100).toFixed(1)) : 0
                      }))}
                      margin={{ top: 10, right: 10, left: -20, bottom: 20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                      <XAxis 
                        dataKey="name" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 11, fill: '#6b7280' }}
                        interval={0}
                        angle={-20}
                        textAnchor="end"
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 11, fill: '#6b7280' }} 
                        unit="%" 
                        domain={[0, 100]}
                      />
                      <Tooltip 
                        formatter={(value: number) => [`${value}%`, 'Conversion Rate']}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                        cursor={{ fill: '#f9fafb' }}
                      />
                      <Bar dataKey="rate" fill="#10b981" radius={[6, 6, 0, 0]} barSize={32} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Lead Status Distribution (Stacked) */}
              <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm lg:col-span-2">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Lead Status Distribution</h3>
                    <p className="text-sm text-gray-500">Volume and status mix of leads per member.</p>
                  </div>
                  <div className="p-2 bg-orange-50 rounded-lg">
                    <TrendingUp className="text-orange-600" size={20} />
                  </div>
                </div>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart 
                      data={teamMemberStats}
                      margin={{ top: 10, right: 10, left: -20, bottom: 20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                      <XAxis 
                        dataKey="name" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 11, fill: '#6b7280' }}
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 11, fill: '#6b7280' }}
                      />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                        cursor={{ fill: '#f9fafb' }}
                      />
                      <Bar dataKey="won" name="Won" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="open" name="Open" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="lost" name="Lost" stackId="a" fill="#ef4444" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* Admin Performance Overview */}
          {isUserAdmin(currentUser?.email) && (
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Individual Performance</h3>
                  <p className="text-sm text-gray-500">Lead conversion metrics per team member.</p>
                </div>
                <Users className="text-gray-400" size={24} />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Member</th>
                      <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">Total</th>
                      <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">Open</th>
                      <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center text-green-600">Won</th>
                      <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center text-red-500">Lost</th>
                      <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center text-brand-blue">Conversion</th>
                      <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center text-orange-600">Call Time</th>
                      <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center text-red-600">Escalations</th>
                      <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {teamMemberStats.map(user => {
                      const convRate = user.total > 0 ? ((user.won / user.total) * 100).toFixed(1) : '0';
                      return (
                        <tr key={user.name} className="hover:bg-gray-50 transition-colors">
                          <td className="py-4 px-4">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-brand-blue/10 flex items-center justify-center text-xs font-bold text-brand-blue border border-brand-blue/20">
                                  {user.name.charAt(0)}
                                </div>
                                <span className="text-sm font-bold text-gray-900">{user.name}</span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {Object.entries(user.stageCounts).map(([stageId, count]) => {
                                  if (count === 0) return null;
                                  const stage = (stages || []).find(s => s.id === stageId);
                                  return (
                                    <span key={stageId} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded border border-gray-200" title={stage?.title}>
                                      {stage?.title?.split(' - ')[1] || stage?.title || stageId}: {count}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-4 text-center">
                            <span className="text-sm font-medium text-gray-700">{user.total}</span>
                          </td>
                          <td className="py-4 px-4 text-center">
                            <span className="text-sm font-medium text-gray-700">{user.open}</span>
                          </td>
                          <td className="py-4 px-4 text-center">
                            <span className="text-sm font-bold text-green-600">{user.won}</span>
                          </td>
                          <td className="py-4 px-4 text-center">
                            <span className="text-sm font-bold text-red-500">{user.lost}</span>
                          </td>
                          <td className="py-4 px-4 text-center">
                            <div className="text-sm font-bold text-brand-blue">{convRate}%</div>
                            <div className="text-[10px] text-gray-400 font-medium">{user.won} Won / {user.total} Total</div>
                          </td>
                          <td className="py-4 px-4 text-center whitespace-nowrap">
                            <div className="text-sm font-bold text-gray-900">
                              {Math.floor(user.totalCallDuration / 3600)}h {Math.floor((user.totalCallDuration % 3600) / 60)}m
                            </div>
                            <div className="text-[10px] text-gray-400 font-medium">{user.totalCalls} Calls</div>
                          </td>
                          <td className="py-4 px-4 text-center">
                            {employeeMetrics[user.name] || employeeMetrics[ADMIN_CONFIG.USERS.find(u => u.name === user.name)?.email || ''] ? (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-600 font-bold text-xs">
                                {employeeMetrics[user.name] || employeeMetrics[ADMIN_CONFIG.USERS.find(u => u.name === user.name)?.email || '']}
                              </span>
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
                          </td>
                          <td className="py-4 px-4 text-right text-sm font-bold text-gray-900">
                            ₹{user.value.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
