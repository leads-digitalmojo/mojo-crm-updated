import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { 
  AlertTriangle, 
  ShieldAlert, 
  ArrowRight,
  Clock,
  User as UserIcon,
  CheckCircle2,
  Calendar,
  AlertOctagon
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { Opportunity, Task } from '../types';
import { getEmployeeName, normalizeOwner, isUserAdmin } from '../lib/admin';

interface EscalationItem {
  id: string;
  leadId: string;
  leadName: string;
  type: 'Missed Follow-up' | 'Missed Task' | 'Urgent SLA Breach';
  detail: string;
  assignee: string;
  date: string;
  status: 'Escalated Today' | 'At Risk (Predicted)';
}

const Escalations: React.FC = () => {
  const navigate = useNavigate();
  const { opportunities, currentUser } = useStore();
  
  const isAdmin = isUserAdmin(currentUser?.email);
  const myName = currentUser?.id ? getEmployeeName(currentUser.id) : '';

  const { escalatedToday, predictedEscalations } = useMemo(() => {
    const today = new Date();
    // Use IST offset for "today" string
    const istDate = new Date(today.getTime() + 5.5 * 60 * 60 * 1000);
    const todayStr = `${istDate.getUTCFullYear()}-${String(istDate.getUTCMonth() + 1).padStart(2, '0')}-${String(istDate.getUTCDate()).padStart(2, '0')}`;
    
    // For predicted (tasks due in the past or today before now)
    const nowTime = today.getTime();

    const todayItems: EscalationItem[] = [];
    const predictedItems: EscalationItem[] = [];

    const getAssigneeName = (rawAssignee: string | undefined | null) => {
      if (!rawAssignee || rawAssignee.toLowerCase() === 'unassigned') return 'Unassigned';
      const normalizedId = normalizeOwner(rawAssignee);
      return getEmployeeName(normalizedId || rawAssignee);
    };

    opportunities.forEach(opp => {
      // 1. Follow-up Escalated Today
      if (opp.followUpEscalated === opp.followUpDate && opp.followUpDate && opp.followUpEscalated) {
        todayItems.push({
          id: `fu-${opp.id}`,
          leadId: opp.id,
          leadName: opp.name,
          type: 'Missed Follow-up',
          detail: `Scheduled for ${opp.followUpDate}`,
          assignee: getAssigneeName(opp.followUpAssignee || opp.owner),
          date: opp.followUpDate,
          status: 'Escalated Today'
        });
      } else if (opp.followUpDate && opp.followUpDate < todayStr && opp.status !== 'Won' && opp.status !== 'Lost' && opp.status !== 'Abandoned') {
        // At Risk Follow-up (missed, but not yet escalated via email)
        predictedItems.push({
          id: `fu-risk-${opp.id}`,
          leadId: opp.id,
          leadName: opp.name,
          type: 'Missed Follow-up',
          detail: `Scheduled for ${opp.followUpDate}`,
          assignee: getAssigneeName(opp.followUpAssignee || opp.owner),
          date: opp.followUpDate,
          status: 'At Risk (Predicted)'
        });
      }

      // 2. Urgent SLA Breach
      if (opp.urgentAlertSent) {
         todayItems.push({
          id: `urgent-${opp.id}`,
          leadId: opp.id,
          leadName: opp.name,
          type: 'Urgent SLA Breach',
          detail: `Initial contact SLA breached`,
          assignee: getAssigneeName(opp.owner),
          date: opp.createdAt ? opp.createdAt.split('T')[0] : todayStr,
          status: 'Escalated Today'
        });
      }

      // 3. Tasks
      if (Array.isArray(opp.tasks)) {
        opp.tasks.forEach(task => {
          if (task.isCompleted) return;

          if (task.emailEscalated) {
             todayItems.push({
              id: `task-${task.id}`,
              leadId: opp.id,
              leadName: opp.name,
              type: 'Missed Task',
              detail: task.title,
              assignee: getAssigneeName(task.assignee || opp.owner),
              date: task.dueDate || todayStr,
              status: 'Escalated Today'
            });
          } else if (task.dueDate && task.dueDate <= todayStr) {
            // Check if it's past due time
            const dueTimeStr = task.dueTime || '23:59';
            const deadlineStr = `${task.dueDate}T${dueTimeStr}:00+05:30`;
            const deadlineTime = new Date(deadlineStr).getTime();
            
            if (nowTime > deadlineTime) {
               predictedItems.push({
                id: `task-risk-${task.id}`,
                leadId: opp.id,
                leadName: opp.name,
                type: 'Missed Task',
                detail: task.title,
                assignee: getAssigneeName(task.assignee || opp.owner),
                date: task.dueDate,
                status: 'At Risk (Predicted)'
              });
            }
          }
        });
      }
    });

    return { escalatedToday: todayItems, predictedEscalations: predictedItems };
  }, [opportunities]);

  // Filter and Group by Assignee
  const { totalAtRisk, totalEscalated, groupedEscalations } = useMemo(() => {
    let all = [...escalatedToday, ...predictedEscalations];
    
    if (!isAdmin) {
      all = all.filter(item => item.assignee === myName);
    }

    const grouped = all.reduce((acc, curr) => {
      const name = curr.assignee;
      if (!acc[name]) acc[name] = [];
      acc[name].push(curr);
      return acc;
    }, {} as Record<string, EscalationItem[]>);

    // Sort assignees alphabetically
    const sortedGrouped = Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0]));
    
    // Calculate totals for the filtered set
    const atRiskCount = all.filter(item => item.status === 'At Risk (Predicted)').length;
    const escalatedCount = all.filter(item => item.status === 'Escalated Today').length;

    return { totalAtRisk: atRiskCount, totalEscalated: escalatedCount, groupedEscalations: sortedGrouped };
  }, [escalatedToday, predictedEscalations, isAdmin, myName]);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ShieldAlert className="text-red-500" />
            Escalations Dashboard
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Track and resolve pending escalations to prevent automated management emails.
          </p>
        </div>
        
        <div className="flex gap-4">
          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex items-center gap-4">
            <div className="bg-red-100 dark:bg-red-900/30 p-3 rounded-lg text-red-600 dark:text-red-400">
              <AlertOctagon size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Active Escalations</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalEscalated}</p>
            </div>
          </div>
          
          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex items-center gap-4">
            <div className="bg-amber-100 dark:bg-amber-900/30 p-3 rounded-lg text-amber-600 dark:text-amber-400">
              <AlertTriangle size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">At Risk (Tomorrow)</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalAtRisk}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {groupedEscalations.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center shadow-sm">
            <div className="bg-green-100 dark:bg-green-900/30 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600 dark:text-green-400">
              <CheckCircle2 size={32} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Zero Escalations!</h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
              Great job team! There are currently no active escalations or items at risk of escalation.
            </p>
          </div>
        ) : (
          groupedEscalations.map(([assignee, items]) => (
            <div key={assignee} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <div className="bg-gray-50 dark:bg-gray-900/50 px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
                <div className="bg-brand-blue/10 p-2 rounded-lg text-brand-blue">
                  <UserIcon size={20} />
                </div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white capitalize">
                  {assignee.split('@')[0]}
                </h2>
                <span className="ml-auto bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold px-2.5 py-1 rounded-full">
                  {items.length} Items
                </span>
              </div>
              
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {items.map(item => (
                  <div key={item.id} className="p-6 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className={`mt-1 p-2 rounded-lg shrink-0 ${
                        item.status === 'Escalated Today' 
                          ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' 
                          : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>
                        {item.type.includes('Task') ? <CheckCircle2 size={20} /> : <Clock size={20} />}
                      </div>
                      
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                            item.status === 'Escalated Today'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                          }`}>
                            {item.status}
                          </span>
                          <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            {item.type}
                          </span>
                        </div>
                        
                        <h3 className="text-base font-bold text-gray-900 dark:text-white">
                          Lead: {item.leadName}
                        </h3>
                        <p className="text-gray-600 dark:text-gray-300 text-sm mt-1 flex items-center gap-2">
                          <span className="font-medium text-gray-900 dark:text-white">Detail:</span> 
                          {item.detail}
                        </p>
                        
                        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 dark:text-gray-400">
                          <span className="flex items-center gap-1">
                            <Calendar size={14} />
                            Due: {item.date}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <button
                      onClick={() => {
                        // Navigate to Opportunities and open that specific lead
                        navigate('/opportunities', { state: { search: item.leadName } });
                      }}
                      className="shrink-0 flex items-center justify-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 px-4 py-2.5 rounded-lg text-sm font-bold transition-colors w-full md:w-auto shadow-sm group"
                    >
                      Resolve Issue
                      <ArrowRight size={16} className="text-gray-400 group-hover:text-brand-blue transition-colors" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Escalations;
