import React, { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { CheckSquare, Search, Filter, Calendar, Clock, ArrowRight, Phone, X } from 'lucide-react';
import { format, parseISO, isPast, isToday, isTomorrow } from 'date-fns';
import { Task } from '../types';
import { canEditTask, canDeleteTask, canToggleTaskCompletion } from '../utils/taskPermissions';

const Tasks: React.FC = () => {
    const { opportunities, updateOpportunity, currentUser, isLoading, isLoadingAuth, stages, fetchOpportunitiesByStage } = useStore();
    const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');
    const [viewScope, setViewScope] = useState<'my' | 'all'>('my');
    const [search, setSearch] = useState('');
    const [selectedTask, setSelectedTask] = useState<(Task & { opportunityName: string; opportunityId: string; opportunityPhone?: string }) | null>(null);

    const TEAM_MEMBERS = [
        { name: 'Komal', email: 'komal@digitalmojo.in', id: 'OwGcGoDXKdPVAMBNTyrY8nDqpmm2' },
        { name: 'Dhiraj', email: 'dhiraj@digitalmojo.in', id: '58Ba96qczERiK7DzBbMkpoko7Vx1' },
        { name: 'Rupal', email: 'rupal@digitalmojo.in', id: 'UNUwlgtVDUc6c9uQVMvBiYjmBYB2' },
        { name: 'Veda', email: 'veda@digitalmojo.in', id: '6l7loPF90teRjJxy61ABWH5GUvX2' }
    ];

    const resolveUserName = (identifier?: string) => {
        if (!identifier) return 'Unknown';

        // 1. Check if it's the current user
        if (identifier === currentUser?.id || identifier === currentUser?.email) {
            return currentUser?.name || 'You';
        }

        // 2. Check Team Members (by email or id)
        const teamMember = TEAM_MEMBERS.find(m => m.email === identifier || m.id === identifier);
        if (teamMember) return teamMember.name;

        // 3. Fallback: If it looks like an email, split it
        if (identifier.includes('@')) return identifier.split('@')[0];

        // 4. Fallback: Just return ID (maybe shortened?) or "User"
        return identifier;
    };

    const isSelfAssigned = (task: Task) => {
        // Check if assignee matches assignedBy
        if (task.assignee === task.assignedBy) return true;

        const assigneeIsMe = task.assignee === currentUser?.id || task.assignee === currentUser?.email;
        const assignedByIsMe = task.assignedBy === currentUser?.id || task.assignedBy === currentUser?.email;
        if (assigneeIsMe && assignedByIsMe) return true;

        return false;
    };


    const renderAssignmentLabel = (task: Task) => {
        if (!task.assignee) return null;

        const isAssignedToMe = task.assignee === currentUser?.id || task.assignee === currentUser?.email;
        const assignedByName = resolveUserName(task.assignedBy);
        const assigneeName = resolveUserName(task.assignee);
        const selfAssigned = isSelfAssigned(task);

        if (isAssignedToMe) {
            if (selfAssigned) {
                return (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-blue-600 bg-blue-50 font-bold">
                        {`• Self Assigned to ${currentUser?.name || 'You'}`}
                    </span>
                );
            } else {
                return (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-blue-600 bg-blue-50 font-bold">
                        {`• Assigned to You by ${assignedByName}`}
                    </span>
                );
            }
        } else {
            if (selfAssigned) {
                return (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-gray-500 bg-gray-100 font-medium">
                        {`• Self Assigned to ${assigneeName}`}
                    </span>
                );
            } else {
                return (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-gray-500 bg-gray-100 font-medium">
                        {`• Assigned to ${assigneeName} by ${assignedByName}`}
                    </span>
                );
            }
        }
    };

    // Initial Data Fetch to ensure we have tasks from all stages (similar to Board View)
    React.useEffect(() => {
        // We fetch opportunities for each stage to ensure the Tasks list is populated 
        // with more than just the default 20 recent items.
        stages.forEach(stage => {
            fetchOpportunitiesByStage(stage.id);
        });
    }, [stages, fetchOpportunitiesByStage]);

    // ... (rest of memoization code)


    // Flatten tasks from all opportunities
    const allTasks = useMemo(() => {
        const tasks: (Task & { opportunityName: string; opportunityId: string; opportunityPhone?: string })[] = [];
        opportunities.forEach(opp => {
            if (opp.tasks) {
                opp.tasks.forEach(task => {
                    tasks.push({
                        ...task,
                        opportunityName: opp.name,
                        opportunityId: opp.id,
                        opportunityPhone: opp.contactPhone
                    });
                });
            }
        });
        return tasks;
    }, [opportunities]);

    const filteredTasks = useMemo(() => {
        return allTasks.filter(task => {
            const matchesSearch =
                (task.title || '').toLowerCase().includes(search.toLowerCase()) ||
                (task.description || '').toLowerCase().includes(search.toLowerCase()) ||
                (task.opportunityName || '').toLowerCase().includes(search.toLowerCase());

            const matchesFilter =
                filter === 'all' ? true :
                    filter === 'completed' ? task.isCompleted :
                        !task.isCompleted;

            const isAssignedToMe = (task.assignee === currentUser?.id || task.assignee === currentUser?.email) && !!(currentUser?.id || currentUser?.email);
            const matchesScope = viewScope === 'all' ? true : isAssignedToMe;

            return matchesSearch && matchesFilter && matchesScope;
        }).sort((a, b) => {
            // Sort by completion (pending first) then by due date
            if (a.isCompleted !== b.isCompleted) {
                return a.isCompleted ? 1 : -1;
            }
            if (!a.dueDate && !b.dueDate) return 0;
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;

            const dateA = new Date(`${a.dueDate}T${a.dueTime || '00:00'}`);
            const dateB = new Date(`${b.dueDate}T${b.dueTime || '00:00'}`);
            return dateA.getTime() - dateB.getTime();
        });
    }, [allTasks, filter, search, viewScope, currentUser]);

    // Calculate task counts for UI indicators
    const myTasksCount = useMemo(() => {
        return allTasks.filter(task =>
            (task.assignee === currentUser?.id || task.assignee === currentUser?.email) &&
            !!(currentUser?.id || currentUser?.email)
        ).length;
    }, [allTasks, currentUser]);

    const allTasksCount = allTasks.length;

    // Diagnostic logging (can be removed in production)
    React.useEffect(() => {
        console.log('🔍 Task Visibility Debug:', {
            currentUser: currentUser?.email,
            totalOpportunities: opportunities.length,
            totalTasks: allTasksCount,
            myTasks: myTasksCount,
            filteredTasks: filteredTasks.length,
            viewScope,
            filter,
            searchActive: !!search,
            isLoading,
            isLoadingAuth
        });
    }, [allTasks, filteredTasks, viewScope, filter, search, currentUser, opportunities, allTasksCount, myTasksCount, isLoading, isLoadingAuth]);

    const handleToggleTask = (task: Task & { opportunityId: string }) => {
        const opp = opportunities.find(o => o.id === task.opportunityId);
        if (!opp || !opp.tasks) return;

        const updatedTasks = opp.tasks.map(t => {
            if (t.id === task.id) {
                const newCompleted = !t.isCompleted;
                return { 
                    ...t, 
                    isCompleted: newCompleted,
                    completedAt: newCompleted ? new Date().toISOString() : undefined,
                    completedBy: newCompleted ? (currentUser?.name || currentUser?.email || 'Unknown') : undefined
                };
            }
            return t;
        });

        updateOpportunity(task.opportunityId, { tasks: updatedTasks });
    };

    const formatTimeToAMPM = (timeStr: string) => {
        if (!timeStr) return '';
        const [hours, minutes] = timeStr.split(':');
        let h = parseInt(hours);
        const m = minutes;
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        h = h ? h : 12; // the hour '0' should be '12'
        return `${h}:${m} ${ampm}`;
    };

    const getDueDateLabel = (dateStr?: string) => {
        if (!dateStr) return null;
        const date = parseISO(dateStr);
        if (isToday(date)) return <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-xs font-medium">Today</span>;
        if (isTomorrow(date)) return <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded text-xs font-medium">Tomorrow</span>;
        if (isPast(date)) return <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded text-xs font-medium">Overdue</span>;
        return <span className="text-gray-500">{format(date, 'MMM d')}</span>;
    };

    if (isLoading || isLoadingAuth) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-blue"></div>
                    <p className="text-gray-500 text-sm">{isLoadingAuth ? 'Initializing...' : 'Loading tasks...'}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 h-full flex flex-col bg-gray-50/50">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-6 md:mb-8">
                <div>
                    <h1 className="text-xl md:text-3xl font-bold text-gray-900">Task List</h1>
                    <p className="hidden md:block text-gray-500 mt-1">Manage your daily to-dos across all opportunities</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-2.5 text-gray-400 h-4 w-4 md:h-5 md:w-5" />
                        <input
                            type="text"
                            placeholder="Search tasks..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary md:w-64"
                        />
                    </div>
                    <div className="flex bg-white border border-gray-200 rounded-lg p-1">
                        {(['my', 'all'] as const).map((v) => (
                            <button
                                key={v}
                                onClick={() => setViewScope(v)}
                                className={`flex-1 sm:flex-none px-3 md:px-4 py-1.5 rounded-md text-xs md:text-sm font-medium capitalize transition-colors flex items-center justify-center gap-2 ${viewScope === v ? 'bg-brand-blue text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
                                    }`}
                            >
                                {v === 'my' ? 'Mine' : 'All'}
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${viewScope === v ? 'bg-white/20' : 'bg-gray-100'}`}>
                                    {v === 'my' ? myTasksCount : allTasksCount}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {filteredTasks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-96 text-center">
                        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-6 text-gray-400">
                            <CheckSquare size={40} />
                        </div>
                        <h3 className="text-xl font-semibold text-gray-900 mb-2">No tasks found</h3>
                        <p className="text-gray-500 max-w-sm mb-6">
                            {viewScope === 'my' && myTasksCount === 0 && allTasksCount > 0 ? (
                                <>
                                    You have no tasks assigned to you. There {allTasksCount === 1 ? 'is' : 'are'}{' '}
                                    <strong>{allTasksCount}</strong> task{allTasksCount === 1 ? '' : 's'} in the system.
                                </>
                            ) : search ? (
                                'No tasks match your search. Try different keywords.'
                            ) : filter !== 'all' ? (
                                `No ${filter} tasks found. Try changing the filter.`
                            ) : (
                                'You have no tasks. Great job staying on top of things!'
                            )}
                        </p>
                        {viewScope === 'my' && myTasksCount === 0 && allTasksCount > 0 && (
                            <button
                                onClick={() => setViewScope('all')}
                                className="px-4 py-2 bg-brand-blue text-white rounded-lg font-medium hover:bg-brand-blue/90 transition-colors mb-4"
                            >
                                View All Tasks ({allTasksCount})
                            </button>
                        )}
                        {(search || filter !== 'all' || viewScope !== 'all') && !(viewScope === 'my' && myTasksCount === 0 && allTasksCount > 0) && (
                            <button
                                onClick={() => {
                                    setSearch('');
                                    setFilter('all');
                                    setViewScope('all');
                                }}
                                className="text-brand-blue font-medium hover:underline"
                            >
                                Clear all filters
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid gap-4 max-w-5xl mx-auto">
                        {filteredTasks.map(task => {
                            const canComplete = canToggleTaskCompletion(task, currentUser?.id, currentUser?.email);
                            const isTaskOverdue = !task.isCompleted && task.dueDate && isPast(parseISO(task.dueDate)) && !isToday(parseISO(task.dueDate));
                            const containerClass = task.isCompleted
                                ? 'opacity-75 bg-gray-50 border-gray-200 shadow-sm'
                                : isTaskOverdue
                                    ? 'bg-red-50 border-red-500 shadow-sm shadow-red-100'
                                    : 'bg-white border-gray-200 shadow-sm hover:shadow-md';

                            return (
                                <div
                                    key={task.id}
                                    className={`group p-4 rounded-xl border transition-all flex items-center gap-4 cursor-pointer ${containerClass}`}
                                    onClick={() => setSelectedTask(task)}
                                >
                                    {canComplete ? (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleToggleTask(task);
                                            }}
                                            className={`flex-shrink-0 w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${task.isCompleted
                                                ? 'bg-primary border-primary text-black'
                                                : 'border-gray-300 hover:border-primary text-transparent'
                                                }`}
                                        >
                                            <CheckSquare size={14} fill="currentColor" />
                                        </button>
                                    ) : (
                                        <div className="flex-shrink-0 w-6 h-6 rounded border-2 border-gray-200 bg-gray-50 flex items-center justify-center opacity-50 cursor-not-allowed" title="Only assigned user can complete this task">
                                            {task.isCompleted && <CheckSquare size={14} fill="currentColor" className="text-gray-400" />}
                                        </div>
                                    )}

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-3 mb-1">
                                            <h3 className={`font-medium text-gray-900 truncate ${task.isCompleted ? 'line-through text-gray-500' : ''}`}>
                                                {task.title}
                                            </h3>
                                            {getDueDateLabel(task.dueDate)}
                                        </div>
                                        {task.description && (
                                            <p className={`text-sm text-gray-600 mb-3 line-clamp-2 ${task.isCompleted ? 'line-through opacity-50' : ''}`}>
                                                {task.description}
                                            </p>
                                        )}
                                        <div className="flex items-center gap-4 text-xs text-gray-500">
                                            <span className="flex items-center gap-1">
                                                <ArrowRight size={12} />
                                                {task.opportunityName}
                                            </span>
                                            {task.opportunityPhone && (
                                                <span className="flex items-center gap-1 text-green-600 font-medium">
                                                    <Phone size={10} />
                                                    {task.opportunityPhone}
                                                </span>
                                            )}
                                            {task.assignee && renderAssignmentLabel(task)}
                                            {task.dueDate && (
                                                <span className="flex items-center gap-1">
                                                    <Calendar size={12} />
                                                    {task.dueDate}
                                                </span>
                                            )}
                                            {task.dueTime && (
                                                <span className="flex items-center gap-1">
                                                    <Clock size={12} />
                                                    {formatTimeToAMPM(task.dueTime)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            {/* Task Details Modal */}
            {selectedTask && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-6">
                            <div className="flex justify-between items-start mb-4">
                                <h2 className="text-xl font-bold text-gray-900 pr-8 break-words">{selectedTask.title}</h2>
                                <button
                                    onClick={() => setSelectedTask(null)}
                                    className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded-full transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="space-y-6">
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Description</h3>
                                    {selectedTask.description ? (
                                        <p className="text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50 p-3 rounded-lg border border-gray-100">
                                            {selectedTask.description}
                                        </p>
                                    ) : (
                                        <p className="text-gray-400 italic">No description provided.</p>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">Opportunity</h3>
                                        <div className="font-medium text-gray-900 flex items-center gap-1.5">
                                            {selectedTask.opportunityName}
                                            <ArrowRight size={14} className="text-gray-400" />
                                        </div>
                                    </div>

                                    {selectedTask.opportunityPhone && (
                                        <div>
                                            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">Contact Phone</h3>
                                            <a
                                                href={`tel:${selectedTask.opportunityPhone}`}
                                                className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg font-medium hover:bg-green-100 transition-colors"
                                            >
                                                <Phone size={14} />
                                                {selectedTask.opportunityPhone}
                                            </a>
                                        </div>
                                    )}
                                </div>

                                {/* Assignment Information */}
                                {selectedTask.assignee && (
                                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                                        <h3 className="text-sm font-semibold text-blue-900 mb-1">Assignment</h3>
                                        <p className="text-sm text-blue-700">
                                            {(() => {
                                                const isAssignedToMe = selectedTask.assignee === currentUser?.id || selectedTask.assignee === currentUser?.email;
                                                const assignedByName = resolveUserName(selectedTask.assignedBy);
                                                const assigneeName = resolveUserName(selectedTask.assignee);
                                                const selfAssigned = isSelfAssigned(selectedTask);

                                                if (isAssignedToMe) {
                                                    if (selfAssigned) {
                                                        return <>Self Assigned: <span className="font-medium">{currentUser?.name || 'You'}</span></>;
                                                    } else {
                                                        return <>Assigned to <span className="font-medium">You</span> by <span className="font-medium">{assignedByName}</span></>;
                                                    }
                                                } else {
                                                    if (selfAssigned) {
                                                        return <>Self Assigned: <span className="font-medium">{assigneeName}</span></>;
                                                    } else {
                                                        return <>Assigned to <span className="font-medium">{assigneeName}</span> by <span className="font-medium">{assignedByName}</span></>;
                                                    }
                                                }
                                            })()}
                                        </p>
                                    </div>
                                )}

                                <div className="flex items-center gap-6 pt-4 border-t border-gray-100 text-sm text-gray-600">
                                    {selectedTask.dueDate && (
                                        <div className="flex items-center gap-2">
                                            <Calendar size={16} className="text-brand-blue" />
                                            <span>{selectedTask.dueDate}</span>
                                        </div>
                                    )}
                                    {selectedTask.dueTime && (
                                        <div className="flex items-center gap-2">
                                            <Clock size={16} className="text-brand-blue" />
                                            <span>{formatTimeToAMPM(selectedTask.dueTime)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="bg-gray-50 px-6 py-4 flex justify-end">
                            <button
                                onClick={() => setSelectedTask(null)}
                                className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
};

export default Tasks;
