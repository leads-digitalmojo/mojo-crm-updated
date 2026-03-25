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
import { TrendingUp, IndianRupee, Target, CheckCircle, Loader2, Users, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useStore } from '../store/useStore';
import { isUserAdmin } from '../lib/admin';

const Dashboard: React.FC = () => {
  const { dashboardStats, fetchDashboardStats, stages, currentUser } = useStore();
  const [timeRange, setTimeRange] = React.useState('30'); // '30', '7', '1'

  // Fetch dashboard stats when time range changes
  useEffect(() => {
    fetchDashboardStats(parseInt(timeRange));
  }, [fetchDashboardStats, timeRange]);

  // Loading state
  if (!dashboardStats) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-brand-blue" />
          <p className="text-gray-500">Loading dashboard data...</p>
        </div>
      </div>
    );
  }

  // Funnel Data: Sort stages logically (Start -> End)
  const stageOrder = ['16', '16.5', 'not responding', '21', '20.5', '20', '19', '18', '17', '10', '0', '0.5'];

  const funnelData = stageOrder.map(id => {
    const stage = stages.find(s => s.id === id);
    if (!stage) return null;
    const stageData = dashboardStats.stageBreakdown[id];
    return {
      name: stage.title.split(' - ')[1] || stage.title,
      fullName: stage.title,
      value: stageData?.count || 0,
      fill: stage.color
    };
  }).filter(Boolean) as any[];

  // Task Data
  const taskData = dashboardStats.taskStats.total > 0 ? [
    { name: 'Completed', value: dashboardStats.taskStats.completed },
    { name: 'Pending', value: dashboardStats.taskStats.pending }
  ] : [];

  const taskColors = ['#1ea34f', '#eb7311'];

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8 bg-gray-50/50 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-3xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex gap-2">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          {
            label: 'Opportunities',
            value: dashboardStats.totalOpportunities.toString(),
            subtext: `${dashboardStats.openOpportunities} Open`,
            icon: Target,
            color: 'text-brand-blue',
            bgColor: 'bg-brand-blue/10'
          },
          {
            label: 'Pipeline Value',
            value: `₹${dashboardStats.totalPipelineValue.toLocaleString()}`,
            subtext: 'Total value',
            icon: IndianRupee,
            color: 'text-brand-green',
            bgColor: 'bg-brand-green/10'
          },
          {
            label: 'Conversion Rate',
            value: `${dashboardStats.conversionRate.toFixed(1)}%`,
            subtext: 'Won / Total',
            icon: TrendingUp,
            color: 'text-brand-purple',
            bgColor: 'bg-brand-purple/10'
          },
          {
            label: 'Closed Won',
            value: dashboardStats.wonOpportunities.toString(),
            subtext: `${dashboardStats.lostOpportunities} Lost`,
            icon: CheckCircle,
            color: 'text-brand-green',
            bgColor: 'bg-brand-green/10'
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
                <stat.icon size={24} />
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
                {dashboardStats.pipelineTrend.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dashboardStats.pipelineTrend}>
                      <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#1ea34f" stopOpacity={0.1} />
                          <stop offset="95%" stopColor="#1ea34f" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} />
                      <Tooltip
                        formatter={(value: number) => [`₹${value.toLocaleString()}`, 'Pipeline Value']}
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
                      <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">Total Leads</th>
                      <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center border-l border-gray-50">Won</th>
                      <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">Lost</th>
                      <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center border-l border-gray-50 text-brand-blue">Conv. Rate</th>
                      <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right border-l border-gray-50">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(() => {
                      const TEAM_MEMBERS = [
                        { name: 'Komal', email: 'komal@digitalmojo.in', id: 'OwGcGoDXKdPVAMBNTyrY8nDqpmm2' },
                        { name: 'Dhiraj', email: 'dhiraj@digitalmojo.in', id: '58Ba96qczERiK7DzBbMkpoko7Vx1' },
                        { name: 'Rupal', email: 'rupal@digitalmojo.in', id: 'UNUwlgtVDUc6c9uQVMvBiYjmBYB2' },
                        { name: 'Veda', email: 'veda@digitalmojo.in', id: '6l7loPF90teRjJxy61ABWH5GUvX2' }
                      ];

                      const stats: Record<string, { name: string, total: number, won: number, lost: number, value: number }> = {};
                      
                      // Initialize stats for known team members
                      TEAM_MEMBERS.forEach(m => {
                        stats[m.email] = { name: m.name, total: 0, won: 0, lost: 0, value: 0 };
                      });

                      (dashboardStats?.allOpportunities || []).forEach(opp => {
                        const assignee = opp.followUpAssignee || 'Unassigned';
                        // Check if assignee matches an ID or Email
                        const member = TEAM_MEMBERS.find(m => m.id === assignee || m.email === assignee);
                        const key = member ? member.email : 'Unassigned';
                        
                        if (!stats[key]) {
                          stats[key] = { name: key, total: 0, won: 0, lost: 0, value: 0 };
                        }
                        
                        stats[key].total++;
                        if (opp.status === 'Won' || opp.stage === '10') stats[key].won++;
                        if (opp.status === 'Lost') stats[key].lost++;
                        stats[key].value += Number(opp.value || 0);
                      });

                      return Object.values(stats)
                        .sort((a, b) => b.total - a.total)
                        .map(user => {
                          const convRate = user.total > 0 ? ((user.won / user.total) * 100).toFixed(1) : '0';
                          return (
                            <tr key={user.name} className="hover:bg-gray-50 transition-colors">
                              <td className="py-4 px-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-full bg-brand-blue/10 flex items-center justify-center text-xs font-bold text-brand-blue border border-brand-blue/20">
                                    {user.name.charAt(0)}
                                  </div>
                                  <span className="text-sm font-bold text-gray-900">{user.name}</span>
                                </div>
                              </td>
                              <td className="py-4 px-4 text-center">
                                <span className="text-sm font-medium text-gray-700">{user.total}</span>
                              </td>
                              <td className="py-4 px-4 text-center border-l border-gray-50">
                                <span className="text-sm font-bold text-green-600">{user.won}</span>
                              </td>
                              <td className="py-4 px-4 text-center">
                                <span className="text-sm font-bold text-red-500">{user.lost}</span>
                              </td>
                              <td className="py-4 px-4 text-center border-l border-gray-50">
                                <div className="flex flex-col items-center">
                                  <span className="text-sm font-bold text-brand-blue">{convRate}%</span>
                                  <div className="w-16 h-1 bg-gray-100 rounded-full mt-1 overflow-hidden">
                                    <div 
                                      className="h-full bg-brand-blue" 
                                      style={{ width: `${Math.min(100, parseFloat(convRate))}%` }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="py-4 px-4 text-right font-bold text-gray-900 border-l border-gray-50">
                                ₹{user.value.toLocaleString()}
                              </td>
                            </tr>
                          );
                        });
                    })()}
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
