import React, { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { formatCurrency, safeParseISO } from '../../utils/format';
import { ADMIN_CONFIG, getEmployeeName, normalizeOwner } from '../../lib/admin';
import { BarChart3, TrendingUp, Users, Target, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths, isWithinInterval } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Line } from 'recharts';

const MonthlyAnalysis: React.FC = () => {
  const { opportunities } = useStore();
  const [selectedMonth, setSelectedMonth] = useState<Date>(startOfMonth(new Date()));

  const handlePrevMonth = () => setSelectedMonth(prev => subMonths(prev, 1));
  const handleNextMonth = () => setSelectedMonth(prev => subMonths(prev, -1));

  const stats = useMemo(() => {
    const currentStart = startOfMonth(selectedMonth);
    const currentEnd = endOfMonth(selectedMonth);
    const prevStart = startOfMonth(subMonths(selectedMonth, 1));
    const prevEnd = endOfMonth(subMonths(selectedMonth, 1));

    const employeeStats: Record<string, any> = {};
    const overall = {
      currentReceived: 0,
      prevReceived: 0,
      currentAddressed: 0,
      prevAddressed: 0,
      currentValue: 0,
      prevValue: 0,
    };

    // Initialize employees
    const SALES_REPS = ['Rupal', 'Veda', 'Komal'];
    ADMIN_CONFIG.USERS.filter(u => SALES_REPS.includes(u.name)).forEach(member => {
      employeeStats[member.id] = {
        name: member.name,
        currentReceived: 0,
        prevReceived: 0,
        currentAddressed: 0,
        prevAddressed: 0,
        currentValue: 0,
        prevValue: 0,
      };
    });

    opportunities.forEach(opp => {
      const owner = normalizeOwner(opp.owner);
      const createdAt = opp.createdAt ? safeParseISO(opp.createdAt) : new Date(0);
      const isCurrentMonth = isWithinInterval(createdAt, { start: currentStart, end: currentEnd });
      const isPrevMonth = isWithinInterval(createdAt, { start: prevStart, end: prevEnd });
      
      const isAddressed = opp.status === 'Won' || opp.status === 'Lost' || opp.status === 'Abandoned';
      const addressedAt = opp.updatedAt ? safeParseISO(opp.updatedAt) : createdAt;
      const isAddressedCurrentMonth = isAddressed && isWithinInterval(addressedAt, { start: currentStart, end: currentEnd });
      const isAddressedPrevMonth = isAddressed && isWithinInterval(addressedAt, { start: prevStart, end: prevEnd });

      // If the owner is not a designated sales rep, we don't track them individually.
      // (They still count towards overall metrics below).
      if (!owner || !employeeStats[owner]) {
        // Just increment overall stats and skip employee individual stats
      } else {
        // Valid tracked employee
        if (isCurrentMonth) {
          employeeStats[owner].currentReceived++;
          employeeStats[owner].currentValue += (opp.value || 0);
        }
        if (isPrevMonth) {
          employeeStats[owner].prevReceived++;
          employeeStats[owner].prevValue += (opp.value || 0);
        }
        if (isAddressedCurrentMonth) {
          employeeStats[owner].currentAddressed++;
        }
        if (isAddressedPrevMonth) {
          employeeStats[owner].prevAddressed++;
        }
      }

      // Always track overall stats regardless of owner
      if (isCurrentMonth) {
        overall.currentReceived++;
        overall.currentValue += (opp.value || 0);
      }
      if (isPrevMonth) {
        overall.prevReceived++;
        overall.prevValue += (opp.value || 0);
      }
      if (isAddressedCurrentMonth) {
        overall.currentAddressed++;
      }
      if (isAddressedPrevMonth) {
        overall.prevAddressed++;
      }
    });

    return { employeeStats: Object.values(employeeStats), overall };
  }, [opportunities, selectedMonth]);

  const renderTrend = (current: number, prev: number, isCurrency = false) => {
    if (current === prev) return <span className="text-gray-400 flex items-center text-xs gap-1"><Minus size={12} /> Same as last month</span>;
    const isUp = current > prev;
    const diff = Math.abs(current - prev);
    const text = isCurrency ? formatCurrency(diff) : diff;
    
    return (
      <span className={`flex items-center text-xs gap-1 font-medium ${isUp ? 'text-green-600' : 'text-red-600'}`}>
        {isUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
        {text} {isUp ? 'more' : 'less'} than last month
      </span>
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto animate-in fade-in zoom-in-95 duration-300">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Monthly Analysis</h2>
          <p className="text-sm text-gray-500 mt-1">Review team performance and lead processing metrics</p>
        </div>
        <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-xl border border-gray-200 shadow-sm">
          <button onClick={handlePrevMonth} className="text-gray-500 hover:text-black transition-colors font-medium text-sm">&larr; Prev</button>
          <span className="font-bold text-gray-900 w-32 text-center">{format(selectedMonth, 'MMMM yyyy')}</span>
          <button onClick={handleNextMonth} disabled={startOfMonth(new Date()).getTime() === selectedMonth.getTime()} className="text-gray-500 hover:text-black transition-colors font-medium text-sm disabled:opacity-30">Next &rarr;</button>
        </div>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm relative overflow-hidden">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Users size={20} /></div>
            <h3 className="font-bold text-gray-900">Total Leads Received</h3>
          </div>
          <div className="text-4xl font-black text-gray-900 mb-2">{stats.overall.currentReceived}</div>
          {renderTrend(stats.overall.currentReceived, stats.overall.prevReceived)}
        </div>
        
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm relative overflow-hidden">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-purple-50 text-purple-600 rounded-lg"><Target size={20} /></div>
            <h3 className="font-bold text-gray-900">Leads Addressed</h3>
          </div>
          <div className="text-4xl font-black text-gray-900 mb-2">{stats.overall.currentAddressed}</div>
          {renderTrend(stats.overall.currentAddressed, stats.overall.prevAddressed)}
        </div>

        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm relative overflow-hidden">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-green-50 text-green-600 rounded-lg"><TrendingUp size={20} /></div>
            <h3 className="font-bold text-gray-900">Pipeline Value Added</h3>
          </div>
          <div className="text-4xl font-black text-gray-900 mb-2">{formatCurrency(stats.overall.currentValue)}</div>
          {renderTrend(stats.overall.currentValue, stats.overall.prevValue, true)}
        </div>
      </div>

      {/* Employee Breakdown */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-50 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 size={18} className="text-gray-400" />
            Employee Performance Breakdown
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-xs uppercase tracking-widest text-gray-500">
                <th className="px-6 py-4 font-bold border-b border-gray-100">Employee</th>
                <th className="px-6 py-4 font-bold border-b border-gray-100">Leads Received</th>
                <th className="px-6 py-4 font-bold border-b border-gray-100">Leads Addressed</th>
                <th className="px-6 py-4 font-bold border-b border-gray-100">Pipeline Generated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 text-sm">
              {stats.employeeStats.sort((a,b) => b.currentReceived - a.currentReceived).map((emp, i) => (
                <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-gray-900 capitalize">{emp.name}</td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900 text-lg">{emp.currentReceived}</div>
                    <div className="mt-1">{renderTrend(emp.currentReceived, emp.prevReceived)}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900 text-lg">{emp.currentAddressed}</div>
                    <div className="mt-1">{renderTrend(emp.currentAddressed, emp.prevAddressed)}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900 text-lg">{formatCurrency(emp.currentValue)}</div>
                    <div className="mt-1">{renderTrend(emp.currentValue, emp.prevValue, true)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Visual Analytics */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Leads Received vs Addressed Chart */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
            <BarChart3 size={18} className="text-blue-500" />
            Leads Received vs Addressed
          </h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stats.employeeStats.sort((a,b) => b.currentReceived - a.currentReceived).filter(e => e.currentReceived > 0 || e.currentAddressed > 0)}
                margin={{ top: 10, right: 10, left: 0, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} />
                <Tooltip 
                  cursor={{ fill: '#F3F4F6' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                <Bar dataKey="currentReceived" name="Received" fill="#3B82F6" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar dataKey="currentAddressed" name="Addressed" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pipeline Value Generation Chart */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
            <TrendingUp size={18} className="text-green-500" />
            Pipeline Generated
          </h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stats.employeeStats.sort((a,b) => b.currentValue - a.currentValue).filter(e => e.currentValue > 0)}
                margin={{ top: 10, right: 10, left: 10, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} />
                <YAxis axisLine={false} tickLine={false} tickFormatter={(val) => `₹${(val/1000).toFixed(0)}k`} tick={{ fontSize: 12, fill: '#6B7280' }} />
                <Tooltip 
                  formatter={(value: number) => formatCurrency(value)}
                  cursor={{ fill: '#F3F4F6' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="currentValue" name="Value (₹)" fill="#8B5CF6" radius={[4, 4, 0, 0]} maxBarSize={50} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MonthlyAnalysis;
