import React, { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { format, isSameDay, parseISO, differenceInDays } from 'date-fns';
import { Users, PhoneCall, AlertTriangle, Activity as ActivityIcon, AlertCircle, ArrowUpRight, ArrowDownRight, Briefcase, Star } from 'lucide-react';
import { formatCurrency, safeParseISO } from '../../utils/format';
import { ADMIN_CONFIG, getEmployeeName, normalizeOwner } from '../../lib/admin';

interface DailyBriefingProps {
  onOpenClientLookup?: (oppId: string) => void;
}

const DailyBriefing: React.FC<DailyBriefingProps> = ({ onOpenClientLookup }) => {
  const { opportunities, currentUser } = useStore();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const metrics = useMemo(() => {
    try {
      const today = selectedDate;
      const todayStr = format(today, 'yyyy-MM-dd');
      const now = new Date();
      const cutoffDate = new Date('2026-06-05T00:00:00Z');
      
      let newLeads = 0;
    let followUps = 0;
    let slaBreaches = 0;
    let totalPipelineValue = 0;
    let potentialLeads = 0;
    let expectedConversionThisMonth = 0;
    let actualConversionThisMonth = 0;

    const todayActivities: any[] = [];
    const hrFlagsMap = new Map<string, number>();

    // Calculate historical win rate for forecasting
    let historicalWonValue = 0;
    let historicalLostValue = 0;
    opportunities.forEach(opp => {
      if (opp.status === 'Won') historicalWonValue += opp.value || 0;
      if (opp.status === 'Lost' || opp.status === 'Abandoned') historicalLostValue += opp.value || 0;
    });
    const winRate = (historicalWonValue + historicalLostValue) > 0 
      ? historicalWonValue / (historicalWonValue + historicalLostValue) 
      : 0.3; // Default 30% if no historical data

    opportunities.forEach(opp => {
      // New Leads
      if (opp.createdAt && isSameDay(safeParseISO(opp.createdAt), today)) {
        newLeads++;
      }

      // Follow-ups
      if (opp.followUpDate === todayStr && opp.status !== 'Won' && opp.status !== 'Abandoned') {
        followUps++;
      }

      // Potential Leads
      if (opp.winLossAnalysis?.isPotentialLead) {
        potentialLeads++;
      }

      // Active Pipeline Value
      if (opp.status !== 'Won' && opp.status !== 'Abandoned') {
        totalPipelineValue += opp.value || 0;
      }
      
      // Actual Conversions this month
      const currentMonth = format(today, 'yyyy-MM');
      const createdMonth = opp.createdAt ? format(safeParseISO(opp.createdAt), 'yyyy-MM') : null;
      
      if (opp.status === 'Won') {
          const wonMonth = opp.statusChangedAt ? format(safeParseISO(opp.statusChangedAt), 'yyyy-MM') : createdMonth;
          if (wonMonth === currentMonth) {
              actualConversionThisMonth += opp.value || 0;
          }
      }

      // SLA Breaches - Follow up
      const fDate = opp.followUpDate ? safeParseISO(opp.followUpDate) : null;
      if (fDate && fDate >= cutoffDate && fDate < now) {
        // Any missed deadline on or after Jun 5 2026 is an active breach
        slaBreaches++;
        const emp = normalizeOwner(opp.followUpAssignee || opp.owner || 'Unknown');
        if (emp) hrFlagsMap.set(emp, (hrFlagsMap.get(emp) || 0) + 1);
      }

      // SLA Breaches - Tasks
      if (Array.isArray(opp.tasks)) {
        opp.tasks.forEach(task => {
          const tDate = task.dueDate ? safeParseISO(task.dueDate) : null;
          if (tDate && tDate >= cutoffDate && tDate < now && task.status !== 'completed') {
            slaBreaches++;
            const emp = normalizeOwner(task.assignedTo || opp.followUpAssignee || opp.owner || 'Unknown');
            if (emp) hrFlagsMap.set(emp, (hrFlagsMap.get(emp) || 0) + 1);
          }
        });
      }

      // Today's Activities
      if (Array.isArray(opp.activities)) {
        opp.activities.forEach(act => {
          if (act.timestamp && isSameDay(safeParseISO(act.timestamp), today)) {
            todayActivities.push({ ...act, opportunityName: opp.name, opportunityId: opp.id });
          }
        });
      }

      // Today's Calls
      if (Array.isArray(opp.calls)) {
        opp.calls.forEach(call => {
          if (call.timestamp && isSameDay(safeParseISO(call.timestamp), today)) {
            todayActivities.push({
               type: 'call',
               timestamp: call.timestamp,
               description: `Call ${call.status ? `(${call.status})` : ''}: ${call.summary || call.transcription || 'No summary'}`,
               user: call.agent || call.caller || 'System',
               opportunityName: opp.name, 
               opportunityId: opp.id 
            });
          }
        });
      }
    });

    todayActivities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    let totalNegotiationValue = 0;
    opportunities.forEach(opp => {
      if (opp.status !== 'Won' && opp.status !== 'Abandoned') {
        if (opp.stage?.includes('20.5')) {
          totalNegotiationValue += opp.value || 0;
        }
      }
    });

    // Forecast Expected Conversion for this month based on active pipeline and win rate
    expectedConversionThisMonth = totalNegotiationValue * 0.3;

    // Needs Attention calculations
    const revenueRisks = opportunities.filter(o => {
      if (o.status === 'Won' || o.status === 'Abandoned') return false;
      let lastActDate = o.updatedAt ? safeParseISO(o.updatedAt) : safeParseISO(o.createdAt || today.toISOString());
      if (Array.isArray(o.activities) && o.activities.length > 0 && o.activities[0].timestamp) {
        lastActDate = safeParseISO(o.activities[0].timestamp);
      }
      return differenceInDays(today, lastActDate) >= 5;
    });

    const stalledDeals = opportunities.filter(o => {
      if (o.status === 'Won' || o.status === 'Abandoned') return false;
      if (o.value < 100000) return false;
      
      const stageChanges = Array.isArray(o.activities) ? o.activities.filter(a => a.type === 'stage_change' && a.timestamp) : [];
      let lastStageDate = o.createdAt ? safeParseISO(o.createdAt) : today;
      if (stageChanges.length > 0) {
        lastStageDate = safeParseISO(stageChanges[0].timestamp);
      }
      return differenceInDays(today, lastStageDate) >= 7;
    });

    const hrFlags = Array.from(hrFlagsMap.entries())
      .filter(([_, count]) => count >= 3)
      .map(([emp, count]) => ({ employee: emp, count }));

      return {
        newLeads,
        followUps,
        slaBreaches,
        totalPipelineValue,
        todayActivities,
        revenueRisks,
        stalledDeals,
        hrFlags,
        potentialLeads,
        expectedConversionThisMonth,
        actualConversionThisMonth
      };
    } catch (error) {
      console.error("DailyBriefing useMemo crash:", error);
      return {
        newLeads: 0, followUps: 0, slaBreaches: 0, totalPipelineValue: 0,
        todayActivities: [], revenueRisks: [], stalledDeals: [], hrFlags: [], potentialLeads: 0, expectedConversionThisMonth: 0, actualConversionThisMonth: 0
      };
    }
  }, [opportunities, selectedDate]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-300">
      
      {/* Header & Date Picker */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
        <h2 className="text-2xl font-bold text-gray-900">Daily Briefing Snapshot</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600">Select Date:</span>
          <input 
            type="date"
            value={format(selectedDate, 'yyyy-MM-dd')}
            onChange={(e) => {
              if (e.target.value) {
                setSelectedDate(new Date(e.target.value));
              }
            }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-brand-blue outline-none bg-white cursor-pointer"
          />
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-gray-100 p-5 rounded-2xl flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">New Leads Today</p>
            <h3 className="text-3xl font-bold text-gray-900 mt-1">{metrics.newLeads}</h3>
          </div>
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <Users size={20} />
          </div>
        </div>

        <div className="bg-white border border-gray-100 p-5 rounded-2xl flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Follow-ups Due</p>
            <h3 className="text-3xl font-bold text-gray-900 mt-1">{metrics.followUps}</h3>
          </div>
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <PhoneCall size={20} />
          </div>
        </div>

        <div className="bg-white border border-gray-100 p-5 rounded-2xl flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">SLA Breaches Today</p>
            <h3 className="text-3xl font-bold text-red-600 mt-1">{metrics.slaBreaches}</h3>
          </div>
          <div className="p-3 bg-red-50 text-red-600 rounded-xl">
            <AlertTriangle size={20} />
          </div>
        </div>

        <div className="bg-white border border-gray-100 p-5 rounded-2xl flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Active Pipeline</p>
            <h3 className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(metrics.totalPipelineValue)}</h3>
          </div>
          <div className="p-3 bg-green-50 text-green-600 rounded-xl">
            <Briefcase size={20} />
          </div>
        </div>

        <div className="bg-white border border-gray-100 p-5 rounded-2xl flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Potential Leads</p>
            <h3 className="text-3xl font-bold text-indigo-900 mt-1">{metrics.potentialLeads}</h3>
          </div>
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <Star size={20} />
          </div>
        </div>
        
        <div className="bg-white border border-gray-100 p-5 rounded-2xl flex items-start justify-between md:col-span-2 lg:col-span-2">
          <div className="w-full">
            <p className="text-sm font-medium text-gray-500 mb-2">Month to Date: Expected vs Actual Conversion</p>
            <div className="flex items-center justify-between w-full">
                <div>
                  <p className="text-xs text-gray-400">Expected (Forecast based on Win Rate)</p>
                  <h3 className="text-2xl font-bold text-gray-900">{formatCurrency(metrics.expectedConversionThisMonth)}</h3>
                </div>
                <div className="flex flex-col items-center px-4">
                  <div className="w-px h-8 bg-gray-200"></div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">Actual (Won Deals)</p>
                  <h3 className="text-2xl font-bold text-green-600">{formatCurrency(metrics.actualConversionThisMonth)}</h3>
                </div>
            </div>
            
            <div className="w-full bg-gray-200 rounded-full h-2.5 mt-3">
              <div 
                className="bg-green-600 h-2.5 rounded-full transition-all duration-500" 
                style={{ 
                    width: metrics.expectedConversionThisMonth > 0 
                        ? `${Math.min(100, (metrics.actualConversionThisMonth / metrics.expectedConversionThisMonth) * 100)}%` 
                        : '0%' 
                }} 
              ></div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Employee Activity Timeline */}
        <div className="lg:col-span-2 bg-white border border-gray-100 rounded-2xl flex flex-col h-[600px]">
          <div className="px-6 py-5 border-b border-gray-50 flex items-center gap-3">
            <div className="p-2 bg-gray-50 rounded-lg">
              <ActivityIcon size={18} className="text-gray-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">Today's Team Activity</h3>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6">
            {metrics.todayActivities.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <ActivityIcon size={32} className="mb-3 opacity-20" />
                <p>No team activity recorded today yet.</p>
              </div>
            ) : (
              <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-gray-200 before:to-transparent">
                {metrics.todayActivities.map((act, idx) => (
                  <div key={act.id + idx} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    {/* Timeline dot */}
                    <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-blue-100 text-blue-600 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10">
                      <span className="text-[10px] font-bold">{(act.userName || '?').charAt(0).toUpperCase()}</span>
                    </div>
                    {/* Content */}
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-blue-600">{act.userName}</span>
                        <time className="text-[10px] text-gray-400 font-medium">
                          {(() => {
                            try {
                              return act.timestamp ? format(safeParseISO(act.timestamp), 'hh:mm a') : 'Unknown';
                            } catch {
                              return 'Invalid time';
                            }
                          })()}
                        </time>
                      </div>
                      <p className="text-sm text-gray-700">{act.description}</p>
                      <p className="text-[10px] text-gray-400 mt-2 flex items-center gap-1">
                        <Briefcase size={10} />
                        {act.opportunityName}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Needs Your Attention */}
        <div className="bg-white border border-gray-100 rounded-2xl flex flex-col h-[600px]">
          <div className="px-6 py-5 border-b border-gray-50 flex items-center gap-3">
            <div className="p-2 bg-red-50 rounded-lg">
              <AlertCircle size={18} className="text-red-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">Needs Attention</h3>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            
            {/* HR Flags */}
            {metrics.hrFlags.map((flag, idx) => {
              const empName = getEmployeeName(flag.employee);
              return (
              <div key={`hr-${idx}`} className="bg-red-50/50 border border-red-100 p-4 rounded-xl">
                <div className="flex items-center gap-2 text-red-700 mb-1">
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-red-100 rounded-full">HR Flag</span>
                </div>
                <h4 className="font-bold text-gray-900 mt-2">{empName}</h4>
                <p className="text-sm text-gray-600 mt-1">Has triggered <span className="font-bold text-red-600">{flag.count} SLA breaches</span> today.</p>
              </div>
            )})}

            {/* Stalled Deals */}
            {metrics.stalledDeals.slice(0, 5).map(deal => (
              <div key={`stalled-${deal.id}`} className="bg-amber-50/50 border border-amber-100 p-4 rounded-xl">
                <div className="flex items-center gap-2 text-amber-700 mb-1">
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-amber-100 rounded-full">Stalled Deal</span>
                  <span className="text-xs font-bold ml-auto">{formatCurrency(deal.value)}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <h4 className="font-bold text-gray-900 truncate">{deal.name}</h4>
                  <button 
                    onClick={() => onOpenClientLookup?.(deal.id!)}
                    className="p-1.5 text-amber-600 hover:bg-amber-100 rounded-md transition-colors"
                    title="View Client Details"
                  >
                    <ArrowUpRight size={16} />
                  </button>
                </div>
                <p className="text-sm text-gray-600 mt-1">No stage movement in 7+ days. Currently in "{deal.stage}".</p>
              </div>
            ))}

            {/* Revenue Risks */}
            {metrics.revenueRisks.slice(0, 5).map(risk => (
              <div key={`risk-${risk.id}`} className="bg-orange-50/50 border border-orange-100 p-4 rounded-xl">
                <div className="flex items-center gap-2 text-orange-700 mb-1">
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-orange-100 rounded-full">Revenue Risk</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <h4 className="font-bold text-gray-900 truncate">{risk.name}</h4>
                  <button 
                    onClick={() => onOpenClientLookup?.(risk.id!)}
                    className="p-1.5 text-orange-600 hover:bg-orange-100 rounded-md transition-colors"
                    title="View Client Details"
                  >
                    <ArrowUpRight size={16} />
                  </button>
                </div>
                <p className="text-sm text-gray-600 mt-1">No activity logged in the last 5+ days.</p>
              </div>
            ))}

            {metrics.hrFlags.length === 0 && metrics.stalledDeals.length === 0 && metrics.revenueRisks.length === 0 && (
              <div className="text-center p-8 text-gray-400">
                <p className="text-sm">All clear. No urgent items.</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default DailyBriefing;
