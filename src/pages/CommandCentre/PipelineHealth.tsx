import React, { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { Brain, AlertTriangle, UserPlus, Target, TrendingUp, Activity, CheckCircle2, ChevronDown, ChevronUp, User, ArrowUpRight } from 'lucide-react';
import { formatCurrency, safeParseISO } from '../../utils/format';
import { differenceInDays, isToday } from 'date-fns';
import { Opportunity } from '../../types';
import { ADMIN_CONFIG, getEmployeeName, normalizeOwner } from '../../lib/admin';

const calculateHealthScore = (opp: Opportunity): number => {
  try {
    if (opp.status === 'Won') return 100;
    if (opp.status === 'Abandoned' || opp.status === 'Lost') return 0;
    
    let score = 85; 
    const today = new Date();
    let lastActDate = opp.updatedAt ? safeParseISO(opp.updatedAt) : safeParseISO(opp.createdAt || today.toISOString());
  
  if (Array.isArray(opp.activities) && opp.activities.length > 0 && opp.activities[0].timestamp) {
    lastActDate = safeParseISO(opp.activities[0].timestamp);
  }
  
  const daysInactive = differenceInDays(today, lastActDate);
  if (daysInactive > 3) score -= (daysInactive - 3) * 2;
  
  let slaCount = 0;
  const cutoffDate = new Date('2026-06-05T00:00:00');
  const now = new Date();
  
  const fDate = opp.followUpDate ? safeParseISO(opp.followUpDate) : null;
  if (fDate && fDate >= cutoffDate && fDate < now) {
    slaCount++;
  }
  
  if (Array.isArray(opp.tasks)) {
    opp.tasks.forEach(t => { 
      const tDate = t.dueDate ? safeParseISO(t.dueDate) : null;
      if (tDate && tDate >= cutoffDate && tDate < now && t.status !== 'completed') {
        slaCount++;
      }
    });
  }
  score -= slaCount * 10;
  
  if (Array.isArray(opp.calls) && opp.calls.length > 0) {
    let totalRating = 0; let ratingCount = 0;
    opp.calls.forEach(c => {
      if (c.aiAnalysis?.rating) { totalRating += c.aiAnalysis.rating; ratingCount++; }
    });
    if (ratingCount > 0) {
      score += ((totalRating / ratingCount) - 5) * 2;
    }
  }
    return Math.max(0, Math.min(100, Math.round(score)));
  } catch (error) {
    console.error("calculateHealthScore crash on opp:", opp.id, error);
    return 0;
  }
};

interface PipelineHealthProps {
  onOpenClientLookup?: (oppId: string) => void;
}

const PipelineHealth: React.FC<PipelineHealthProps> = ({ onOpenClientLookup }) => {
  const { opportunities } = useStore();
  const [expandedRecIndex, setExpandedRecIndex] = useState<number | null>(null);

  const metrics = useMemo(() => {
    try {
      const activeOpps = opportunities.filter(o => o.status === 'Open');
      
      const potentialLeads = opportunities.filter(o => o.winLossAnalysis?.isPotentialLead === true);
    
    if (activeOpps.length === 0 && potentialLeads.length === 0) {
      return {
        avgHealth: 0,
        totalValue: 0,
        stalledHighValue: [],
        workload: {},
        recommendations: [],
        potentialCount: 0
      };
    }

    // 1. Overall Pipeline Health and Value
    const totalHealth = activeOpps.reduce((sum, opp) => sum + calculateHealthScore(opp), 0);
    const avgHealth = Math.round(totalHealth / activeOpps.length);
    const totalValue = activeOpps.reduce((sum, opp) => sum + (opp.value || 0), 0);
    const negotiationValue = activeOpps.filter(o => o.stage?.includes('20.5')).reduce((sum, opp) => sum + (opp.value || 0), 0);
    const projectedValue = negotiationValue * 0.3;

    // 2. High Value Rotting Leads
    const today = new Date();
    const stalledHighValue = activeOpps.filter(opp => {
      const lastActDate = opp.updatedAt ? safeParseISO(opp.updatedAt) : safeParseISO(opp.createdAt || today.toISOString());
      return opp.value >= 50000 && differenceInDays(today, lastActDate) >= 7;
    });

    // 3. Workload Analysis
    const workload: Record<string, { followUps: number, wonRecently: number }> = {};
    opportunities.forEach(opp => {
      // Use followUpAssignee if available, otherwise owner
      const owner = normalizeOwner(opp.followUpAssignee || opp.owner);
      if (!owner) return;
      
      if (!workload[owner]) workload[owner] = { followUps: 0, wonRecently: 0 };
      
      if (opp.followUpDate && isToday(safeParseISO(opp.followUpDate)) && opp.status === 'Open') {
        workload[owner].followUps++;
      }
      
      if (opp.status === 'Won' && opp.updatedAt && differenceInDays(today, safeParseISO(opp.updatedAt)) <= 7) {
        workload[owner].wonRecently++;
      }
    });

    // 4. Employee Issues (for Coaching)
    // The user requested: "only target the lead with open state" which is already handled via activeOpps
    const employeeIssues: Record<string, { slaBreaches: number, stalledDeals: number, slaOpps: Opportunity[], stalledOpps: Opportunity[] }> = {};
    activeOpps.forEach(opp => {
      const owner = normalizeOwner(opp.followUpAssignee || opp.owner);
      if (!owner) return;
      
      if (!employeeIssues[owner]) employeeIssues[owner] = { slaBreaches: 0, stalledDeals: 0, slaOpps: [], stalledOpps: [] };
      
      const lastActDate = opp.updatedAt ? safeParseISO(opp.updatedAt) : safeParseISO(opp.createdAt || today.toISOString());
      if (opp.value >= 50000 && differenceInDays(today, lastActDate) >= 7) {
         employeeIssues[owner].stalledDeals++;
         employeeIssues[owner].stalledOpps.push(opp);
      }

      let isSlaBreached = false;
      const cutoffDate = new Date('2026-06-05T00:00:00');
      const now = new Date();
      
      const fDate = opp.followUpDate ? safeParseISO(opp.followUpDate) : null;
      // Deadline missed if date is after cutoff but before now
      if (fDate && fDate >= cutoffDate && fDate < now) {
         isSlaBreached = true;
      }
      
      if (Array.isArray(opp.tasks)) {
        opp.tasks.forEach(t => { 
          const tDate = t.dueDate ? safeParseISO(t.dueDate) : null;
          if (tDate && tDate >= cutoffDate && tDate < now && t.status !== 'completed') {
            isSlaBreached = true;
          }
        });
      }
      
      if (isSlaBreached) {
        employeeIssues[owner].slaBreaches++;
        employeeIssues[owner].slaOpps.push(opp);
      }
    });
    const coachingData = Object.entries(employeeIssues).filter(([_, issues]) => issues.slaBreaches > 0 || issues.stalledDeals > 0);

    // Generate AI Action Plans (Deterministic Mock)
    const recommendations: any[] = [];

    // Rec 1: Stalled Value
    if (stalledHighValue.length > 0) {
      const totalStalledValue = stalledHighValue.reduce((sum, o) => sum + o.value, 0);
      recommendations.push({
        type: 'critical',
        icon: AlertTriangle,
        color: 'text-red-500 bg-red-50',
        title: `${stalledHighValue.length} high-value leads are rotting`,
        description: `There is ${formatCurrency(totalStalledValue)} tied up in deals with no movement in 7+ days. Recommend: Direct intervention and reassign to top closers immediately.`,
        actionType: 'list_clients',
        actionData: stalledHighValue
      });
    }

    // Rec 2: Workload Imbalance
    const overloadedUser = Object.entries(workload).sort((a, b) => b[1].followUps - a[1].followUps)[0];
    if (overloadedUser && overloadedUser[1].followUps > 5) {
      const empName = getEmployeeName(overloadedUser[0]);
      recommendations.push({
        type: 'warning',
        icon: UserPlus,
        color: 'text-amber-500 bg-amber-50',
        title: `${empName} has heavy follow-up load today`,
        description: `${empName} has ${overloadedUser[1].followUps} follow-ups scheduled today. Recommend: Shift their focus entirely to closures or reassign early-stage follow-ups.`
      });
    }

    // Rec 3: Pipeline Velocity
    const avgScoreDesc = avgHealth >= 80 ? "Pipeline health is excellent." : avgHealth >= 60 ? "Pipeline is stabilizing." : "Pipeline health is critical.";
    recommendations.push({
      type: 'info',
      icon: TrendingUp,
      color: 'text-blue-500 bg-blue-50',
      title: 'Focus on velocity',
      description: `${avgScoreDesc} Recommended action: Review SLA breaches and focus the team on moving deals from "Proposal" to "Closed" this week.`,
      actionType: 'velocity_coaching',
      actionData: coachingData
    });

    // Rec 4: Potential Leads Identified
    if (potentialLeads.length > 0) {
      recommendations.push({
        type: 'success',
        icon: Target,
        color: 'text-green-500 bg-green-50',
        title: `${potentialLeads.length} Potential Leads Identified by AI`,
        description: `AI analysis of closed/abandoned deals has identified ${potentialLeads.length} leads with high potential for revival. Check the Win/Loss Analysis tab.`,
        actionType: 'list_clients',
        actionData: potentialLeads
      });
    }

      return { avgHealth, totalValue, projectedValue, recommendations, potentialCount: potentialLeads.length };
    } catch (error) {
      console.error("PipelineHealth useMemo crash:", error);
      return {
        avgHealth: 0,
        totalValue: 0,
        projectedValue: 0,
        recommendations: [],
        potentialCount: 0
      };
    }
  }, [opportunities]);

  return (
    <div className="p-6 max-w-7xl mx-auto animate-in fade-in zoom-in-95 duration-300">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Gauge */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-gray-100 p-8 flex flex-col items-center justify-center text-center shadow-sm">
          <Activity size={24} className="text-gray-400 mb-6" />
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-6">Overall Pipeline Score</h3>
          
          <div className="relative">
            {/* SVG Gauge */}
            <svg className="w-48 h-48 transform -rotate-90">
              <circle
                cx="96" cy="96" r="88"
                stroke="currentColor" strokeWidth="12" fill="transparent"
                className="text-gray-100"
              />
              <circle
                cx="96" cy="96" r="88"
                stroke="currentColor" strokeWidth="12" fill="transparent"
                strokeDasharray={`${2 * Math.PI * 88}`}
                strokeDashoffset={`${2 * Math.PI * 88 * (1 - metrics.avgHealth / 100)}`}
                className={`transition-all duration-1000 ease-out ${
                  metrics.avgHealth >= 80 ? 'text-green-500' : metrics.avgHealth >= 60 ? 'text-amber-500' : 'text-red-500'
                }`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-6xl font-black ${
                metrics.avgHealth >= 80 ? 'text-green-600' : metrics.avgHealth >= 60 ? 'text-amber-600' : 'text-red-600'
              }`}>
                {metrics.avgHealth}
              </span>
              <span className="text-xs text-gray-400 mt-2 font-medium">OUT OF 100</span>
            </div>
          </div>

          <p className="mt-8 text-sm text-gray-500 font-medium">
            Based on average health score of all active leads, factoring in SLAs and activity velocity.
          </p>

          <div className="mt-8 pt-6 border-t border-gray-100 w-full grid grid-cols-2 gap-4 text-center">
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Total Pipeline</p>
              <p className="text-xl font-bold text-gray-900">{formatCurrency(metrics.totalValue || 0)}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Expected (30% Neg.)</p>
              <p className="text-xl font-bold text-indigo-600">{formatCurrency(metrics.projectedValue || 0)}</p>
            </div>
          </div>
        </div>

        {/* Right Column: AI Recommendations */}
        <div className="lg:col-span-8 flex flex-col">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <Brain size={20} />
            </div>
            <h2 className="text-xl font-bold text-gray-900">AI Recommendation Drawer</h2>
            <div className="ml-auto flex items-center gap-2">
               <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
              </span>
              <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest">Live Analysis</span>
            </div>
          </div>

          <div className="space-y-4 flex-1 pb-10">
            {metrics.recommendations.map((rec, i) => {
              const Icon = rec.icon;
              const isExpanded = expandedRecIndex === i;
              const hasAction = rec.actionType;

              return (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 flex flex-col hover:shadow-md transition-shadow group overflow-hidden">
                  <div className="p-6 flex gap-5">
                    <div className={`p-4 rounded-xl h-fit shrink-0 ${rec.color}`}>
                      <Icon size={24} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-bold text-gray-900 mb-2 group-hover:text-indigo-600 transition-colors">{rec.title}</h3>
                      <p className="text-gray-600 leading-relaxed">{rec.description}</p>
                      {hasAction && (
                        <button 
                          onClick={() => setExpandedRecIndex(isExpanded ? null : i)}
                          className="mt-4 text-sm font-bold text-indigo-600 flex items-center gap-1 transition-opacity"
                        >
                          {isExpanded ? 'Hide Details' : 'Take Action'} 
                          {isExpanded ? <ChevronUp size={16} /> : <Target size={14} className="ml-1" />}
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {isExpanded && hasAction && (
                    <div className="px-6 pb-6 pt-2 border-t border-gray-50 bg-gray-50/50">
                      {rec.actionType === 'list_clients' && rec.actionData && (
                        <div className="space-y-3 mt-4">
                          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Impacted Clients</h4>
                          {rec.actionData.map((client: Opportunity) => (
                            <div key={client.id} className="flex items-center justify-between bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
                              <div>
                                <p className="text-sm font-bold text-gray-900">{client.name}</p>
                                <p className="text-xs text-gray-500">{client.companyName || 'No Company'} • {formatCurrency(client.value)}</p>
                              </div>
                              <button 
                                onClick={() => onOpenClientLookup?.(client.id!)}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors"
                              >
                                View in Lookup
                                <ArrowUpRight size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {rec.actionType === 'velocity_coaching' && rec.actionData && (
                        <div className="space-y-4 mt-4">
                          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">AI Coaching Scripts</h4>
                          {rec.actionData.map(([empId, issues]: [string, any]) => {
                            const empName = getEmployeeName(empId);
                            return (
                              <div key={empId} className="bg-white p-4 rounded-xl border border-indigo-100 shadow-sm relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500" />
                                <div className="flex items-center gap-2 mb-3">
                                  <User size={16} className="text-indigo-500" />
                                  <span className="text-sm font-bold text-gray-900 capitalize">{empName}</span>
                                  <div className="ml-auto flex gap-2 text-xs font-medium">
                                    {issues.slaBreaches > 0 && <span className="px-2 py-0.5 bg-red-50 text-red-700 rounded-full">{issues.slaBreaches} SLA Breaches</span>}
                                    {issues.stalledDeals > 0 && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full">{issues.stalledDeals} Stalled Deals</span>}
                                  </div>
                                </div>
                                <div className="bg-indigo-50/50 p-3 rounded-lg border border-indigo-100/50 mb-3">
                                  <p className="text-sm text-indigo-900 italic font-medium leading-relaxed">
                                    "Hey <span className="capitalize">{empName}</span>, I'm reviewing the pipeline velocity and noticed you have {issues.slaBreaches > 0 ? `${issues.slaBreaches} SLA breaches ` : ''}{issues.slaBreaches > 0 && issues.stalledDeals > 0 ? 'and ' : ''}{issues.stalledDeals > 0 ? `${issues.stalledDeals} high-value stalled deals ` : ''}right now. What roadblocks are you facing with these, and how can we get them moving to 'Closed' this week?"
                                  </p>
                                </div>
                                {((issues.slaOpps && issues.slaOpps.length > 0) || (issues.stalledOpps && issues.stalledOpps.length > 0)) && (
                                  <div className="space-y-2 mt-3 pt-3 border-t border-gray-100">
                                    <h5 className="text-xs font-bold text-gray-500 uppercase">Impacted Deals (Proofs)</h5>
                                    {issues.slaOpps?.map((opp: Opportunity) => (
                                      <div key={`sla-${opp.id}`} className="flex items-center justify-between bg-gray-50 p-2 rounded border border-gray-100">
                                        <div className="flex items-center gap-2">
                                          <AlertTriangle size={14} className="text-red-500" />
                                          <span className="text-xs font-medium text-gray-700">{opp.name} (SLA Breach)</span>
                                        </div>
                                        <button onClick={() => onOpenClientLookup?.(opp.id!)} className="text-[10px] font-bold text-indigo-600 hover:underline">View</button>
                                      </div>
                                    ))}
                                    {issues.stalledOpps?.map((opp: Opportunity) => (
                                      <div key={`stalled-${opp.id}`} className="flex items-center justify-between bg-gray-50 p-2 rounded border border-gray-100">
                                        <div className="flex items-center gap-2">
                                          <Target size={14} className="text-amber-500" />
                                          <span className="text-xs font-medium text-gray-700">{opp.name} (Stalled: {formatCurrency(opp.value)})</span>
                                        </div>
                                        <button onClick={() => onOpenClientLookup?.(opp.id!)} className="text-[10px] font-bold text-indigo-600 hover:underline">View</button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {metrics.recommendations.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 flex flex-col items-center justify-center text-center h-full text-gray-400">
                <CheckCircle2 size={48} className="mb-4 text-green-400" />
                <p className="text-lg font-medium text-gray-600">Pipeline is healthy and optimized.</p>
                <p className="text-sm">No critical actions recommended at this time.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PipelineHealth;
