import React, { useState, useEffect, useRef, useMemo, memo, useCallback } from 'react';
import Papa from 'papaparse';
import { Plus, MoreHorizontal, X, Trash2, LayoutGrid, List as ListIcon, Search, Filter, Download, ChevronDown, User, Phone, Mail, Tag, CheckSquare, MessageSquare, Clock, ArrowUpDown, Calendar, Edit2, Target, BarChart, XCircle, TrendingUp, Users, Save, PhoneIncoming, PhoneOutgoing, Timer, RefreshCw, Play, Volume2, Zap, Award, Sparkles, Star } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { useStore } from '../store/useStore';
import { api } from '../services/api';
import { DndContext, DragEndEvent, useDraggable, useDroppable, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { Modal } from '../components/Modal';
import { Opportunity, Task, Note, OpportunityActivity, Appointment } from '../types';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { useSearchParams } from 'react-router-dom';


import { canEditTask, canDeleteTask, canToggleTaskCompletion } from '../utils/taskPermissions';
import { isUserAdmin, ADMIN_CONFIG } from '../lib/admin';

const getParsedDate = (val: any) => {
    if (!val) return 0;
    // Handle Date objects
    if (val instanceof Date) return val.getTime();
    // Handle Firebase Timestamp objects with .toDate() method
    if (typeof val?.toDate === 'function') return val.toDate().getTime();
    // Handle plain objects with seconds (from JSON serialization)
    if (val && typeof val === 'object' && ('seconds' in val || '_seconds' in val)) {
        return ((val as any).seconds || (val as any)._seconds) * 1000;
    }
    // Handle numbers (timestamps)
    if (typeof val === 'number') return val;
    // Handle ISO strings or other date strings
    const d = new Date(val).getTime();
    return isNaN(d) ? 0 : d;
};

const safeFormat = (dateInput, formatStr) => {
    try {
        if (!dateInput) return '-';
        const timestamp = getParsedDate(dateInput);
        if (timestamp === 0) return '-';
        return format(new Date(timestamp), formatStr);
    } catch(e) {
        return '-';
    }
};

/**
 * IST Helpers for Urgent Lead Staggering
 */
const getInIST = (date: Date = new Date()) => {
    return new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
};

const getSessionStart = (date: Date) => {
    const ist = getInIST(date);
    const day = ist.getDay(); 
    const hour = ist.getHours();
    const min = ist.getMinutes();
    const timeVal = hour * 100 + min;

    const isWeekend = (day === 0 || day === 6);
    const isBeforeWork = timeVal < 1000;
    const isAfterWork = timeVal >= 1930;

    if (!isWeekend && !isBeforeWork && !isAfterWork) return ist;

    let sessionDate = new Date(ist);
    sessionDate.setHours(10, 0, 0, 0);
    if (isAfterWork) sessionDate.setDate(sessionDate.getDate() + 1);
    while (sessionDate.getDay() === 0 || sessionDate.getDay() === 6) {
        sessionDate.setDate(sessionDate.getDate() + 1);
    }
    return sessionDate;
};

const CountdownTimer = ({ dueDate }: { dueDate: Date }) => {
    const [timeLeft, setTimeLeft] = useState<number>(0);

    useEffect(() => {
        const calculate = () => {
             const now = getInIST();
             const diff = Math.max(0, Math.floor((dueDate.getTime() - now.getTime()) / 1000));
             setTimeLeft(diff);
        };
        calculate();
        const interval = setInterval(calculate, 1000);
        return () => clearInterval(interval);
    }, [dueDate]);

    if (timeLeft <= 0) {
        return (
            <div className="flex items-center gap-1 text-red-600 font-bold animate-pulse text-[10px] bg-red-50 px-1.5 py-0.5 rounded border border-red-100">
                <Timer size={10} />
                <span>URGENT</span>
            </div>
        );
    }

    const mins = Math.floor(timeLeft / 60);
    const secs = timeLeft % 60;

    return (
        <div className={`flex items-center gap-1 font-mono font-bold text-[10px] px-1.5 py-0.5 rounded border ${
            timeLeft < 60 ? 'bg-orange-50 text-orange-600 border-orange-100 animate-pulse' : 'bg-blue-50 text-blue-600 border-blue-100'
        }`}>
            <Clock size={10} />
            <span>{String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}</span>
        </div>
    );
};


interface DraggableCardProps {
    item: Opportunity;
    color: string;
    onEdit: (opp: Opportunity) => void;
    onDelete: (id: string) => void;
    nextAppointment?: { date: string; time: string; title: string };
    effectiveDueDate?: Date;
    onScoreSingleLead?: (e: React.MouseEvent, leadId: string) => void;
    isScoring?: boolean;
}

const DraggableCard = memo<DraggableCardProps>(({ item, color, onEdit, onDelete, nextAppointment, effectiveDueDate, onScoreSingleLead, isScoring }) => {
    const { stages } = useStore();
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: item.id,
    });
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    } : undefined;

    // Handle click separately to avoid conflict with drag
    const handleCardClick = (e: React.MouseEvent) => {
        // Only trigger edit if not dragging
        if (!isDragging && !confirmingDelete) {
            onEdit(item);
        }
    };

    let displayStatus = item.status;
    const stageName = stages.find(s => s.id === item.stage)?.title?.toLowerCase() || '';
    if (stageName.includes('junk') || stageName.includes('no budget') || stageName.includes('dead')) {
        displayStatus = 'Abandoned';
    } else if (stageName.includes('won') || stageName.includes('closed') || stageName.includes('success')) {
        displayStatus = 'Won';
    } else if (!displayStatus || displayStatus === 'Not Answered') {
        // preserve other statuses
    } else if (displayStatus !== 'Lost') { // Don't override explicit Lost if not matching above
        displayStatus = 'Open';
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`bg-white p-4 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-all relative group mb-3 z-10 ${isDragging ? 'opacity-50' : ''}`}
        >
            {/* Drag Handle - only this area is draggable */}
            <div
                {...listeners}
                {...attributes}
                className="absolute top-0 left-0 right-0 h-8 cursor-grab"
            />

            {/* Clickable Content Area */}
            <div onClick={handleCardClick} className="cursor-pointer">
                {/* Header */}
                <div className="flex justify-between items-start mb-3">
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-bold text-gray-900 text-sm line-clamp-2">{item.name}</h4>
                            {displayStatus && displayStatus.toLowerCase() !== 'open' && (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                                    displayStatus === 'Won' ? 'bg-green-100 text-green-700' :
                                    (displayStatus === 'Lost' || displayStatus === 'Abandoned') ? 'bg-red-100 text-red-700' :
                                    displayStatus === 'Not Answered' ? 'bg-orange-100 text-orange-700' :
                                    'bg-blue-100 text-blue-700'
                                }`}>
                                    {displayStatus === 'Not Answered' ? 'N/A' : displayStatus}
                                </span>
                            )}
                            {item.aiCallStatus && (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 flex items-center gap-1 ${
                                    item.aiCallStatus === 'Scheduled' ? 'bg-purple-100 text-purple-700' :
                                    item.aiCallStatus === 'Completed' ? 'bg-teal-100 text-teal-700' :
                                    item.aiCallStatus === 'Failed' ? 'bg-red-100 text-red-700' :
                                    'bg-gray-100 text-gray-700'
                                }`} title="Huskyvoice AI Status">
                                    {item.aiCallStatus === 'Scheduled' && <Clock size={10} />}
                                    {item.aiCallStatus === 'Completed' && <Sparkles size={10} />}
                                    {item.aiCallStatus === 'Failed' && <XCircle size={10} />}
                                    AI: {item.aiCallStatus}
                                </span>
                            )}
                            {item.winLossAnalysis?.isPotentialLead && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 flex items-center gap-1 bg-indigo-100 text-indigo-800" title="Identified as Potential Revival by AI">
                                    <Star size={10} />
                                    Potential
                                </span>
                            )}
                            {item.aiPotentialScore !== undefined ? (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 flex items-center gap-1 ${item.aiPotentialScore >= 80 ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-700'}`} title={`AI Score: ${item.aiPotentialScore} - ${item.potentialReason || ''}`}>
                                    <Star size={10} className={item.aiPotentialScore >= 80 ? 'fill-yellow-500 text-yellow-500' : 'text-gray-500'} />
                                    {item.aiPotentialScore >= 80 ? 'High Potential' : 'Score'}: {item.aiPotentialScore}
                                </span>
                            ) : (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onScoreSingleLead && onScoreSingleLead(e, item.id);
                                    }}
                                    disabled={isScoring}
                                    className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 flex items-center gap-1 bg-blue-100 text-blue-800 hover:bg-blue-200 transition-colors disabled:opacity-50"
                                >
                                    {isScoring ? <div className="w-2.5 h-2.5 border-2 border-blue-800 border-t-transparent rounded-full animate-spin"></div> : <Star size={10} />}
                                    Score
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            {item.contactId && (
                                <span
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        window.location.hash = `#/contacts/${item.contactId}`;
                                    }}
                                    className="text-xs text-brand-blue hover:underline cursor-pointer flex items-center gap-1"
                                >
                                    <User size={10} /> {item.contactName || 'View Contact'}
                                </span>
                            )}
                            {effectiveDueDate && !item.urgentAlertSent && (
                                <CountdownTimer dueDate={effectiveDueDate} />
                            )}
                        </div>
                    </div>
                    <div className="flex items-center">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onEdit(item);
                            }}
                            className="text-gray-400 hover:text-gray-600 p-1"
                        >
                            <MoreHorizontal size={16} />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="space-y-2 mb-4">
                    <div className="flex text-xs">
                        <span className="text-gray-500 w-32 shrink-0">Business Name:</span>
                        <span className="text-gray-700 font-medium truncate">{item.name}</span>
                    </div>
                    <div className="flex text-xs">
                        <span className="text-gray-500 w-32 shrink-0">Opportunity Value:</span>
                        <span className="text-gray-700 font-medium">₹{Number(item.value).toLocaleString()}</span>
                    </div>

                    {item.notes && item.notes.length > 0 && (
                        <div className="flex text-xs">
                            <span className="text-gray-500 w-32 shrink-0">Notes:</span>
                            <span className="text-gray-700 truncate italic">
                                "{[...item.notes].sort((a, b) => new Date((b.createdAt as any)?.seconds ? (b.createdAt as any).toDate() : b.createdAt || 0).getTime() - new Date((a.createdAt as any)?.seconds ? (a.createdAt as any).toDate() : a.createdAt || 0).getTime())[0]?.content || ''}"
                            </span>
                        </div>
                    )}

                    <div className="flex text-xs">
                        <span className="text-gray-500 w-32 shrink-0">Follow up:</span>
                        <span className="text-gray-700 font-medium">
                            {item.followUpDate ? safeFormat(item.followUpDate, 'MMM d, yyyy') : 'No date set'}
                        </span>
                    </div>

                    {item.source && (
                        <div className="flex text-xs">
                            <span className="text-gray-500 w-32 shrink-0">Source:</span>
                            <span className="text-gray-700 font-medium truncate">{item.source}</span>
                        </div>
                    )}

                    <div className="flex text-xs">
                        <span className="text-gray-500 w-32 shrink-0">Stage:</span>
                        <span className="text-gray-700 font-medium truncate">
                            {stages.find(s => s.id === item.stage)?.title || item.stage}
                        </span>
                    </div>

                    {item.opportunityType && (
                        <div className="flex text-xs">
                            <span className="text-gray-500 w-32 shrink-0">Type:</span>
                            <span className="text-gray-700 font-medium truncate text-brand-blue">{item.opportunityType}</span>
                        </div>
                    )}

                    {item.calls && item.calls.length > 0 && (
                        <div className="flex text-xs">
                            <span className="text-gray-500 w-32 shrink-0">Voice Calls:</span>
                            <div className="flex items-center gap-1.5 text-orange-600 font-bold">
                                <Phone size={10} />
                                <span>{item.calls.length} calls</span>
                                <span className="text-gray-400 font-normal">•</span>
                                <span>
                                    {Math.floor(item.calls.reduce((acc: number, c: any) => acc + (c.duration || 0), 0) / 60)}m {item.calls.reduce((acc: number, c: any) => acc + (c.duration || 0), 0) % 60}s
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer - outside clickable area */}
            <div className="flex justify-end items-center border-t border-gray-100 pt-3">
                {confirmingDelete ? (
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <span className="text-xs text-gray-600 font-medium">Delete?</span>
                        <button
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setConfirmingDelete(false);
                                onDelete(item.id);
                            }}
                            className="px-2 py-0.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 font-medium"
                        >
                            Yes
                        </button>
                        <button
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setConfirmingDelete(false);
                            }}
                            className="px-2 py-0.5 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300 font-medium"
                        >
                            No
                        </button>
                    </div>
                ) : (
                    <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setConfirmingDelete(true);
                        }}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Delete Opportunity"
                    >
                        <Trash2 size={14} />
                    </button>
                )}
            </div>
        </div>
    );
});

DraggableCard.displayName = 'DraggableCard';



interface DroppableColumnProps {
    stage: { id: string; title: string; color: string };
    items: Opportunity[];
    onEdit: (opp: Opportunity) => void;
    onDelete: (id: string) => void;
    hasMore: boolean;
    onLoadMore: () => void;
    isLoading?: boolean;
    totalCount: number;
    totalValue: number;
    appointments?: Appointment[];
    onScoreSingleLead?: (e: React.MouseEvent, leadId: string) => void;
    scoringLeads?: Set<string>;
}

const DroppableColumn = memo<DroppableColumnProps>(({ stage, items, onEdit, onDelete, hasMore, onLoadMore, isLoading, totalCount, totalValue, appointments, onScoreSingleLead, scoringLeads }) => {
    const { setNodeRef } = useDroppable({
        id: stage.id,
    });

    const loadMoreRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Infinite scroll using IntersectionObserver
    useEffect(() => {
        const loadMoreElement = loadMoreRef.current;
        const scrollContainer = scrollContainerRef.current;

        if (!loadMoreElement || !scrollContainer) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const [entry] = entries;
                if (entry.isIntersecting && hasMore && !isLoading) {
                    onLoadMore();
                }
            },
            {
                root: scrollContainer,
                rootMargin: '100px',
                threshold: 0.1
            }
        );

        observer.observe(loadMoreElement);

        return () => {
            observer.disconnect();
        };
    }, [hasMore, onLoadMore, isLoading]);

    return (
        <div ref={setNodeRef} className="w-80 flex flex-col h-full">
            <div className="bg-white p-3 rounded-t-lg border-t-4 shadow-sm mb-2 shrink-0" style={{ borderTopColor: stage.color || '#3b82f6' }}>
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="font-bold text-gray-800 text-sm uppercase tracking-wide">{stage.title}</h3>
                        <p className="text-xs text-gray-500 mt-1">
                            {totalCount} Opportunities <span className="font-bold text-gray-700 ml-1">₹{totalValue.toLocaleString()}</span>
                        </p>
                    </div>
                </div>
            </div>

            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto custom-scrollbar min-h-[100px] pr-1 pb-2">
                {(() => {
                    // Staggering Logic for Stage 16
                    let sessionPoolCounts: Record<string, number> = {};
                    
                    // Sort items by createdAt descending (latest first)
                    const sortedItems = [...items].sort((a, b) => {
                        const dateA = getParsedDate(a.createdAt);
                        const dateB = getParsedDate(b.createdAt);
                        return dateB - dateA;
                    });

                    return sortedItems.map(item => {
                        const apt = appointments
                            .filter(a => a.contactId === item.contactId && new Date(`${a.date}T${a.time}`) >= new Date())
                            .sort((a, b) => new Date(`${a.date}T${a.time}`).getTime() - new Date(`${b.date}T${b.time}`).getTime())[0];

                        // Calculate effective date if item is in Stage 16
                        let effectiveDueDate: Date | undefined;
                        if (stage.id === '16' && !item.urgentAlertSent) {
                            const createdAt = new Date(item.createdAt || Date.now());
                            const sessionStart = getSessionStart(createdAt);
                            const isPooled = sessionStart.getHours() === 10 && sessionStart.getMinutes() === 0;
                            
                            let effectiveStart = sessionStart;
                            if (isPooled) {
                                const sKey = sessionStart.toISOString();
                                const rank = sessionPoolCounts[sKey] || 0;
                                effectiveStart = new Date(sessionStart.getTime() + rank * 5 * 60 * 1000);
                                sessionPoolCounts[sKey] = rank + 1;
                            }
                            effectiveDueDate = new Date(effectiveStart.getTime() + 5 * 60 * 1000);
                        }

                        return (
                            <DraggableCard 
                                key={item.id} 
                                item={item} 
                                color={stage.color} 
                                onEdit={onEdit} 
                                onDelete={onDelete} 
                                nextAppointment={apt}
                                effectiveDueDate={effectiveDueDate} 
                                onScoreSingleLead={onScoreSingleLead}
                                isScoring={scoringLeads?.has(item.id)}
                            />
                        );
                    });
                })()}
                {/* Sentinel element for infinite scroll */}
                <div ref={loadMoreRef} className="h-4">
                    {isLoading && hasMore && (
                        <div className="flex justify-center py-2">
                            <div className="w-5 h-5 border-2 border-brand-blue border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

DroppableColumn.displayName = 'DroppableColumn';

const AnalyticsDashboard = ({ opportunities, stages }: { opportunities: Opportunity[], stages: any[] }) => {
    const stats = useMemo(() => {
        const teamStats: Record<string, any> = {};
        
        // Initialize stats for all known users
        ADMIN_CONFIG.USERS.forEach(user => {
            teamStats[user.email.toLowerCase()] = {
                name: user.name,
                total: 0,
                won: 0,
                lost: 0,
                inProgress: 0,
                value: 0
            };
        });

        (opportunities || []).forEach(opp => {
            if (!opp) return; // Guard against null/undefined in array
            
            const assigneeRawValue = (opp.followUpAssignee || opp.owner || '').trim().toLowerCase();
            if (!assigneeRawValue) return;

            // Resolve to formal email if it matches name, id, or email in whitelist
            const userMatch = ADMIN_CONFIG.USERS.find(u => 
                u.email.toLowerCase() === assigneeRawValue || 
                u.name.toLowerCase() === assigneeRawValue || 
                (u.id && u.id.toLowerCase() === assigneeRawValue)
            );
            
            const assignee = userMatch ? userMatch.email.toLowerCase() : assigneeRawValue;

            if (teamStats[assignee]) {
                teamStats[assignee].total++;
                teamStats[assignee].value += (Number(opp.value) || 0);
                
                const stageData = (stages || []).find(s => s.id === opp.stage);
                const stageTitle = stageData?.title?.toLowerCase() || '';
                
                if (stageTitle.includes('won') || stageTitle.includes('closed') || stageTitle.includes('success')) {
                    teamStats[assignee].won++;
                } else if (stageTitle.includes('lost') || stageTitle.includes('junk') || stageTitle.includes('dead')) {
                    teamStats[assignee].lost++;
                } else {
                    teamStats[assignee].inProgress++;
                }
            } else {
                // If assignee doesn't exist in whitelist, track them anyway to avoid data loss
                if (!teamStats[assignee]) {
                    teamStats[assignee] = { name: assignee, total: 0, won: 0, lost: 0, inProgress: 0, value: 0 };
                }
                teamStats[assignee].total++;
                teamStats[assignee].value += (Number(opp.value) || 0);
            }
        });

        return Object.values(teamStats).sort((a: any, b: any) => (b.total || 0) - (a.total || 0));
    }, [opportunities, stages]);

    return (
        <div className="h-full overflow-auto p-4 md:p-6 bg-gray-50">
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                        <BarChart className="text-brand-blue" />
                        Team Performance Analytics
                    </h2>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                        <div className="text-gray-500 text-sm font-medium flex items-center gap-2 mb-1">
                            <Target size={16} className="text-brand-blue" /> Total Leads
                        </div>
                        <div className="text-2xl font-bold text-gray-900">{opportunities.length}</div>
                    </div>
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                        <div className="text-gray-500 text-sm font-medium flex items-center gap-2 mb-1">
                            <TrendingUp size={16} className="text-green-500" /> Avg. Conversion
                        </div>
                        <div className="text-2xl font-bold text-gray-900">
                            {opportunities.length ? Math.round((stats.reduce((acc, s) => acc + s.won, 0) / (opportunities.length || 1)) * 100) : 0}%
                        </div>
                    </div>
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                        <div className="text-gray-500 text-sm font-medium flex items-center gap-2 mb-1">
                            <Users size={16} className="text-purple-500" /> Active Members
                        </div>
                        <div className="text-2xl font-bold text-gray-900">{stats.filter(s => s.total > 0).length}</div>
                    </div>
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                        <div className="text-gray-500 text-sm font-medium flex items-center gap-2 mb-1">
                            <Save size={16} className="text-yellow-500" /> Pipeline Value
                        </div>
                        <div className="text-2xl font-bold text-gray-900">
                            ₹{stats.reduce((acc, s) => acc + s.value, 0).toLocaleString()}
                        </div>
                    </div>
                </div>

                {/* Team Table */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                        <h3 className="font-bold text-gray-700">Team Member Breakdown</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                                <tr>
                                    <th className="px-6 py-3 font-semibold">Employee</th>
                                    <th className="px-6 py-3 font-semibold text-center">Total Leads</th>
                                    <th className="px-6 py-3 font-semibold text-center">Won</th>
                                    <th className="px-6 py-3 font-semibold text-center">Lost</th>
                                    <th className="px-6 py-3 font-semibold text-center">Conversion</th>
                                    <th className="px-6 py-3 font-semibold text-right">Value</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {stats.map((member: any) => (
                                    <tr key={member.name} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-brand-blue/10 flex items-center justify-center text-brand-blue font-bold text-xs">
                                                    {member.name.charAt(0)}
                                                </div>
                                                <span className="font-medium text-gray-900">{member.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-center font-semibold text-gray-700">{member.total}</td>
                                        <td className="px-6 py-4 text-center">
                                            <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold">
                                                {member.won}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold">
                                                {member.lost}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col items-center gap-1">
                                                <span className="text-sm font-bold text-gray-800">
                                                    {member.total ? Math.round((member.won / member.total) * 100) : 0}%
                                                </span>
                                                <div className="w-24 bg-gray-100 h-1.5 rounded-full overflow-hidden">
                                                    <div 
                                                        className="bg-brand-blue h-full rounded-full" 
                                                        style={{ width: `${member.total ? (member.won / member.total) * 100 : 0}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right font-bold text-gray-900">
                                            ₹{member.value.toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

const Opportunities: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { opportunities, appointments, stages, stageCounts, stagePagination, fetchOpportunities, fetchOpportunitiesByStage, loadMoreByStage, fetchStageCounts, updateOpportunity, addOpportunity, deleteOpportunity, bulkDeleteOpportunities, updateStages, currentUser, addAppointment, fetchAppointments, contacts, fetchContacts, addContact, updateContact, deleteContact, hasMoreOpportunities, loadMoreOpportunities, isLoading, discoveryResponses, fetchDiscoveryResponses } = useStore();
    const [isAnalyzingPotential, setIsAnalyzingPotential] = useState(false);
    const [scoringLeads, setScoringLeads] = useState<Set<string>>(new Set());

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5,
            },
        })
    );

    const handleScoreSingleLead = async (e: React.MouseEvent, leadId: string) => {
        e.stopPropagation();
        if (scoringLeads.has(leadId)) return;
        
        setScoringLeads(prev => {
            const next = new Set(prev);
            next.add(leadId);
            return next;
        });
        
        try {
            const analyzeFn = httpsCallable(functions, 'analyzeSingleLeadPotential');
            const result = await analyzeFn({ leadId });
            const data = result.data as any;
            
            if (data.success) {
                toast.success('Lead scored successfully');
                await updateOpportunity(leadId, {
                    aiPotentialScore: data.score,
                    isHighPotential: data.score >= 80,
                    potentialReason: data.reason
                });
            } else {
                toast.error(data.error || 'Failed to score lead');
            }
        } catch (error: any) {
            console.error('Error scoring lead:', error);
            toast.error(error.message || 'Failed to score lead');
        } finally {
            setScoringLeads(prev => {
                const next = new Set(prev);
                next.delete(leadId);
                return next;
            });
        }
    };
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isPipelineModalOpen, setIsPipelineModalOpen] = useState(false);
    const [viewMode, setViewMode] = useState<'board' | 'list' | 'analytics'>('board');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState('Contact Info');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [leadFilter, setLeadFilter] = useState<'all' | 'assigned' | 'unassigned'>('all');

    // Form State
    const [formData, setFormData] = useState({
        name: '',
        value: '',
        stage: '',
        status: 'Open',
        source: '',
        contactName: '',
        contactEmail: '',
        contactPhone: '',
        companyName: '',
        your_website: '',
        budget: '',
        tags: '',
        calendar: '',
        contactValue: 'Standard',
        followUpDate: '',
        opportunityType: '',
        followUpAssignee: '',
        meta_campaign: '',
        meta_adset: '',
        secondaryPhones: [] as string[]
    });

    // Sub-items State
    const [tasks, setTasks] = useState<Task[]>([]);
    const [notes, setNotes] = useState<Note[]>([]);
    const [newTaskTitle, setNewTaskTitle] = useState('');
    const [newTaskDescription, setNewTaskDescription] = useState('');
    const [newTaskDueDate, setNewTaskDueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [newTaskDueTime, setNewTaskDueTime] = useState('08:00');
    const [newTaskAssignee, setNewTaskAssignee] = useState('');
    const [newTaskIsRecurring, setNewTaskIsRecurring] = useState(false);
    const [newNoteContent, setNewNoteContent] = useState('');
    const [isAddingTask, setIsAddingTask] = useState(false);
    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
    const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
    const [isAddingNote, setIsAddingNote] = useState(false);
    const [isSyncingSalestrail, setIsSyncingSalestrail] = useState(false);
    const [isSendingAssets, setIsSendingAssets] = useState(false);

    useEffect(() => {
        if (activeTab === 'discovery' && formData.contactPhone) {
            fetchDiscoveryResponses(formData.contactPhone);
        }
    }, [activeTab, formData.contactPhone, fetchDiscoveryResponses]);

    const handleSalestrailSync = async () => {
        if (isSyncingSalestrail) return;
        
        setIsSyncingSalestrail(true);
        const syncToast = toast.loading('Syncing Salestrail calls... (this may take a few minutes)');
        
        try {
            const manualSync = httpsCallable(functions, 'manualSalestrailSync');
            const result: any = await manualSync();
            
            if (result.data?.success) {
                const { matches, updated, analyzed } = result.data;
                let msg = `Sync complete! ${matches} matches, ${updated} leads updated.`;
                if (analyzed > 0) msg += ` AI analyzed ${analyzed} calls.`;
                toast.success(msg, { id: syncToast, duration: 6000 });
                // Refresh data
                fetchOpportunities();
            } else {
                toast.error(`Sync failed: ${result.data?.error || 'Unknown error'}`, { id: syncToast });
            }
        } catch (error: any) {
            console.error('Salestrail Sync Error:', error);
            toast.error(`Sync error: ${error.message}`, { id: syncToast });
        } finally {
            setIsSyncingSalestrail(false);
        }
    };

    const currentStageObj = stages.find(s => String(s.id) === String(formData.stage));
    const currentStageId = String(formData.stage || '').trim();
    const currentStageTitle = (currentStageObj?.title || '').toLowerCase();
    
    const isYetToContactUI = currentStageId === '16' || currentStageTitle.includes('yet to contact');
    const isJunkOrNoBudgetUI = 
        currentStageId === '0' || 
        currentStageId === '0.5' || 
        currentStageTitle.includes('junk') || 
        currentStageTitle.includes('no budget');

    const handleSendSalesAssets = async () => {
        if (!editingId) return;

        if (isSendingAssets) return;

        setIsSendingAssets(true);
        const toastId = toast.loading('Sending sales assets sequence...');

        try {
            const { sendSalesAssets } = useStore.getState();
            await sendSalesAssets(editingId);
            toast.success('Sales assets sequence triggered successfully!', { id: toastId });
        } catch (error: any) {
            console.error('Failed to send sales assets:', error);
            toast.error(error.message || 'Failed to send sales assets', { id: toastId });
        } finally {
            setIsSendingAssets(false);
        }
    };

    const [isAnalyzingDiscovery, setIsAnalyzingDiscovery] = useState<Record<string, boolean>>({});

    const handleAnalyzeDiscovery = async (response: any) => {
        if (isAnalyzingDiscovery[response.id]) return;

        setIsAnalyzingDiscovery(prev => ({ ...prev, [response.id]: true }));
        const toastId = toast.loading('AI is analyzing lead potential...');

        try {
            await api.discovery.analyzeResponse(response.id, response.responses);
            toast.success('Analysis complete!', { id: toastId });
            // Refresh to get the analysis from Firestore
            if (formData.contactPhone) {
                fetchDiscoveryResponses(formData.contactPhone);
            }
        } catch (error: any) {
            console.error('AI Analysis Error:', error);
            toast.error(error.message || 'AI Analysis failed', { id: toastId });
        } finally {
            setIsAnalyzingDiscovery(prev => ({ ...prev, [response.id]: false }));
        }
    };

    const TEAM_MEMBERS = ADMIN_CONFIG.USERS;

    // Appointment State
    const [appointmentForm, setAppointmentForm] = useState({
        calendar: '',
        location: '',
        title: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        time: '09:00'
    });

    // Pipeline editing state
    const [tempStages, setTempStages] = useState(stages);

    useEffect(() => {
        fetchOpportunities();
        fetchContacts();
        fetchStageCounts();
        fetchAppointments();
    }, [fetchOpportunities, fetchContacts, fetchStageCounts, fetchAppointments, currentUser]);

    // Separate effect: fetch per-stage data whenever stages load/change from Firebase
    useEffect(() => {
        if (!currentUser || stages.length === 0) return;
        stages.forEach(stage => {
            fetchOpportunitiesByStage(stage.id);
        });
    }, [stages, currentUser, fetchOpportunitiesByStage]);

    useEffect(() => {
        setTempStages(stages);
    }, [stages]);

    // FILTER STATE
    const [searchTerm, setSearchTerm] = useState('');
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [isSortOpen, setIsSortOpen] = useState(false);
    const [sortBy, setSortBy] = useState<'date' | 'stage' | 'followUp' | 'none'>('none');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const filterRef = useRef<HTMLDivElement>(null);
    const sortRef = useRef<HTMLDivElement>(null);
    const [filters, setFilters] = useState({
        stage: [] as string[],
        status: '',
        opportunityType: '',
        selectedMonth: '',
        assignee: '',
        source: '',
        meta_campaign: '',
        meta_adset: ''
    });

    const getStageRank = (title: string) => {
        if (!title || typeof title !== 'string') return 999;
        const match = title.match(/^(\d+(\.\d+)?)/);
        return match ? parseFloat(match[1]) : 999;
    };

    const sortedStages = useMemo(() => {
        // Only apply numeric sort if explicitly sorting by 'stage'
        if (sortBy === 'stage') {
            const sorted = [...stages].sort((a, b) => getStageRank(a.title) - getStageRank(b.title));
            return sortOrder === 'desc' ? sorted.reverse() : sorted;
        }

        // Otherwise, use the default order as defined in the system/database
        // This follows the order: 16, 21, 20.5, 20, 19, 18, 17, 10, 0, 0.5
        return stages;
    }, [stages, sortBy, sortOrder]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
                setIsFilterOpen(false);
            }
            if (sortRef.current && !sortRef.current.contains(event.target as Node)) {
                setIsSortOpen(false);
            }
        };

        if (isFilterOpen || isSortOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isFilterOpen, isSortOpen]);

    // List view infinite scroll refs
    const listScrollContainerRef = useRef<HTMLDivElement>(null);
    const listLoadMoreRef = useRef<HTMLTableRowElement>(null);

    // List view infinite scroll
    useEffect(() => {
        if (viewMode !== 'list') return;

        const loadMoreElement = listLoadMoreRef.current;
        const scrollContainer = listScrollContainerRef.current;

        if (!loadMoreElement || !scrollContainer) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const [entry] = entries;
                if (entry.isIntersecting && hasMoreOpportunities && !isLoading) {
                    loadMoreOpportunities();
                }
            },
            {
                root: scrollContainer,
                rootMargin: '100px',
                threshold: 0.1
            }
        );

        observer.observe(loadMoreElement);

        return () => {
            observer.disconnect();
        };
    }, [viewMode, hasMoreOpportunities, loadMoreOpportunities, isLoading]);

    // getParsedDate is now defined at the top level

    const sortOpps = (a: Opportunity, b: Opportunity) => {
        if (sortBy === 'none') {
            const dateA = getParsedDate(a.createdAt);
            const dateB = getParsedDate(b.createdAt);
            return dateB - dateA;
        }
        if (sortBy === 'stage') {
            const stageA = stages.find(s => s.id === a.stage);
            const stageB = stages.find(s => s.id === b.stage);
            const rankA = stageA ? getStageRank(stageA.title) : 999;
            const rankB = stageB ? getStageRank(stageB.title) : 999;
            if (rankA !== rankB) {
                return sortOrder === 'asc' ? rankA - rankB : rankB - rankA;
            }
            // Keep opportunities inside same stage sorted by date descending
            const dateA = getParsedDate(a.createdAt);
            const dateB = getParsedDate(b.createdAt);
            return dateB - dateA;
        } else if (sortBy === 'followUp') {
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            const today = now.getTime();

            const getPriority = (dateStr?: string) => {
                if (!dateStr) return 3; // No date
                const d = new Date(dateStr).getTime();
                if (d >= today) return 1; // Today or Future
                return 2; // Past (Overdue)
            };

            const prioA = getPriority(a.followUpDate);
            const prioB = getPriority(b.followUpDate);

            if (prioA !== prioB) {
                // Always keep "No date" (priority 3) at the bottom
                if (prioA === 3) return 1;
                if (prioB === 3) return -1;
                // Otherwise sort by priority (1: Future, 2: Past)
                return sortOrder === 'asc' ? prioA - prioB : prioB - prioA;
            }

            const dateA = a.followUpDate ? new Date(a.followUpDate).getTime() : 0;
            const dateB = b.followUpDate ? new Date(b.followUpDate).getTime() : 0;

            if (dateA !== dateB) {
                return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
            }
            // Fallback to createdAt
            return getParsedDate(b.createdAt) - getParsedDate(a.createdAt);
        } else {
            const dateA = getParsedDate(a.createdAt);
            const dateB = getParsedDate(b.createdAt);
            return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
        }
    };

    const visibleOpportunities = useMemo(() => {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const today = now.getTime();

        return opportunities.filter(opp => {
            // Text Search with null-safety
            const matchesSearch =
                (opp.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (opp.contactName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (opp.companyName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (opp.contactPhone || '').includes(searchTerm) ||
                (opp.source || '').toLowerCase().includes(searchTerm.toLowerCase());

            // Advanced Filters
            const matchesStage = filters.stage.length > 0 ? filters.stage.includes(opp.stage) : true;
            const matchesStatus = filters.status ? opp.status === filters.status : true;
            const matchesType = filters.opportunityType ? opp.opportunityType === filters.opportunityType : true;

            // Follow-up specific filtering: Only show Today/Future dates
            if (sortBy === 'followUp') {
                if (!opp.followUpDate) return false;
                if (new Date(opp.followUpDate).getTime() < today) return false;
            }

            let createdAtStr = '';
            if (opp.createdAt) {
                if (typeof opp.createdAt === 'string') {
                    createdAtStr = opp.createdAt;
                } else if (typeof (opp.createdAt as any).toDate === 'function') {
                    createdAtStr = (opp.createdAt as any).toDate().toISOString();
                } else {
                    createdAtStr = new Date(opp.createdAt as any).toISOString();
                }
            }
            const matchesMonth = filters.selectedMonth ? (createdAtStr.startsWith(filters.selectedMonth)) : true;
            let matchesAssignee = true;
            if (filters.assignee) {
                const targetMember = ADMIN_CONFIG.USERS.find(m => 
                    m.name.toLowerCase() === filters.assignee.toLowerCase() || 
                    m.email.toLowerCase() === filters.assignee.toLowerCase()
                );
                
                const raw1 = (opp.followUpAssignee || '').trim().toLowerCase();
                const raw2 = (opp.owner || '').trim().toLowerCase();
                
                if (targetMember) {
                    matchesAssignee = 
                        raw1 === targetMember.email.toLowerCase() || 
                        raw1 === targetMember.name.toLowerCase() || 
                        raw1 === targetMember.id.toLowerCase() ||
                        raw2 === targetMember.email.toLowerCase() || 
                        raw2 === targetMember.name.toLowerCase() || 
                        raw2 === targetMember.id.toLowerCase();
                } else {
                    matchesAssignee = raw1 === filters.assignee.toLowerCase() || raw2 === filters.assignee.toLowerCase();
                }
            }
            // Lead Filter Logic
            const matchesLeadFilter = leadFilter === 'assigned'
                ? (opp.followUpAssignee === currentUser?.id || opp.followUpAssignee === currentUser?.email)
                : leadFilter === 'unassigned'
                    ? (!opp.owner || opp.owner.trim() === '') && (!opp.followUpAssignee || opp.followUpAssignee.trim() === '')
                    : true;

            const matchesSource = !filters.source || (opp.source || '').toLowerCase().includes(filters.source.toLowerCase());
            const matchesCampaign = !filters.meta_campaign || (opp.meta_campaign || '').toLowerCase().includes(filters.meta_campaign.toLowerCase());
            const matchesAdset = !filters.meta_adset || (opp.meta_adset || '').toLowerCase().includes(filters.meta_adset.toLowerCase());

            return matchesSearch && matchesStage && matchesStatus && matchesType && matchesMonth && matchesAssignee && matchesLeadFilter && matchesSource && matchesCampaign && matchesAdset;
        }).sort(sortOpps);
    }, [opportunities, searchTerm, filters.stage, filters.status, filters.opportunityType, filters.selectedMonth, filters.assignee, filters.source, sortOrder, sortBy, stages, viewMode, leadFilter]);

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;

        if (!over) return;

        const activeId = active.id as string;
        const overId = over.id as string;

        // Find the opportunity and the new stage
        const opportunity = opportunities.find(o => o.id === activeId);
        if (!opportunity) return;

        // If dropped over a container (stage)
        if (stages.some(s => s.id === overId)) {
            if (opportunity.stage !== overId) {
                // Special case: Junk and No Budget moves are allowed without a note via drag-and-drop
                if (overId === '0' || overId === '0.5') {
                    try {
                        const stageTitle = overId === '0' ? 'Junk' : 'No Budget';
                        await updateOpportunity(activeId, { 
                            stage: overId,
                            status: 'Abandoned',
                            followUpDate: '' // Clear follow-up date
                        });
                        toast.success(`Lead moved to ${stageTitle}`);
                        return;
                    } catch (error) {
                        toast.error(`Failed to move lead`);
                        return;
                    }
                }

                // NEW ENFORCEMENT: Any other stage change requires a note.
                // Since drag-and-drop doesn't allow adding a note, we force the modal open.
                const destId = String(overId);
                const destStage = stages.find(s => String(s.id) === destId);
                const destTitle = (destStage?.title || '').toLowerCase();
                const isDestExempt = destId === '0' || destId === '0.5' || destTitle.includes('junk') || destTitle.includes('no budget');

                if (!isDestExempt) {
                    const todayStr = new Date().toLocaleDateString('en-CA');
                    const hasNoteToday = Array.isArray(opportunity.notes) && opportunity.notes.some(note => {
                        let noteDate = new Date(0);
                        if (note.createdAt) {
                            if (typeof note.createdAt === 'string') noteDate = new Date(note.createdAt);
                            else if (typeof (note.createdAt as any).toDate === 'function') noteDate = (note.createdAt as any).toDate();
                            else noteDate = new Date(note.createdAt as any);
                        }
                        return !isNaN(noteDate.getTime()) && noteDate.toLocaleDateString('en-CA') === todayStr;
                    });
                    
                    const hasTaskToday = Array.isArray(opportunity.tasks) && opportunity.tasks.some(task => {
                        let taskDate = new Date(0);
                        if ((task as any).createdAt) {
                            if (typeof (task as any).createdAt === 'string') taskDate = new Date((task as any).createdAt);
                            else if (typeof ((task as any).createdAt as any).toDate === 'function') taskDate = ((task as any).createdAt as any).toDate();
                            else taskDate = new Date((task as any).createdAt as any);
                        } else {
                            const parsedId = parseInt(task.id);
                            if (!isNaN(parsedId) && parsedId > 1000000000000) {
                                taskDate = new Date(parsedId);
                            }
                        }
                        return !isNaN(taskDate.getTime()) && taskDate.toLocaleDateString('en-CA') === todayStr;
                    });

                    if (!hasNoteToday && !hasTaskToday) {
                        toast.error("Stage change requires a note or task for today. Please update via the modal.");
                        handleOpenModal(opportunity, overId);
                        return;
                    } else {
                        // Allow drag and drop
                        try {
                            const newStatus = destTitle.includes('won') || destTitle.includes('closed') || destTitle.includes('success') ? 'Won' : 'Open';
                            await updateOpportunity(activeId, { 
                                stage: overId,
                                status: newStatus
                            });
                            toast.success(`Lead moved to ${destStage?.title || 'new stage'}`);
                            return;
                        } catch (error) {
                            toast.error(`Failed to move lead`);
                            return;
                        }
                    }
                }
            }
        }
    };

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            setSelectedIds(new Set(visibleOpportunities.map(o => o.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleSelectOne = (id: string) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
    };

    const handleBulkDelete = async () => {
        if (window.confirm(`Are you sure you want to delete ${selectedIds.size} opportunities?`)) {
            try {
                await bulkDeleteOpportunities(Array.from(selectedIds));
                toast.success(`${selectedIds.size} opportunities deleted successfully`);
                setSelectedIds(new Set());
            } catch (error) {
                toast.error('Failed to delete opportunities');
            }
        }
    };

    const handleOpenModal = (opp?: Opportunity, targetStage?: string) => {
        if (opp) {
            setEditingId(opp.id);
            const linkedContact = contacts.find(c => c.id === (opp.contactId || ''));

            // Safety check for value
            const oppValue = opp.value !== undefined && opp.value !== null ? opp.value.toString() : "0";
            // Auto-update status if moved to 'Closed' (Won) stage (Stage ID '10')
            let initialStatus = opp.status || 'Open';
            if (targetStage === '10') {
                initialStatus = 'Won';
            } else if (String(opp.stage) === '10' && targetStage && String(targetStage) !== '10') {
                initialStatus = 'Open';
            }

            const tStage = String(targetStage || '');
            const targetStageObj = stages.find(s => String(s.id) === tStage);
            const targetTitle = (targetStageObj?.title || '').toLowerCase();
            const isTargetExempt = tStage === '0' || tStage === '0.5' || targetTitle.includes('junk') || targetTitle.includes('no budget');
            const isActuallyChanging = targetStage && String(targetStage) !== String(opp.stage);

            // Removed shouldClearFollowUp logic to preserve existing followUpDate

            setFormData({
                name: opp.name || '',
                value: oppValue,
                stage: targetStage || opp.stage || '16',
                status: initialStatus,
                source: opp.source || '',
                contactName: linkedContact?.name || opp.contactName || '',
                contactEmail: linkedContact?.email || opp.contactEmail || '',
                contactPhone: linkedContact?.phone || opp.contactPhone || '',
                companyName: linkedContact?.companyName || opp.companyName || '',
                your_website: opp.your_website || '',
                budget: opp.budget || '',
                tags: Array.isArray(opp.tags) ? opp.tags.join(', ') : '',
                calendar: opp.calendar || '',
                contactValue: linkedContact?.Value || 'Standard',
                followUpDate: opp.followUpDate || '',
                opportunityType: opp.opportunityType || '',
                followUpAssignee: opp.followUpAssignee || '',
                meta_campaign: opp.meta_campaign || '',
                meta_adset: opp.meta_adset || '',
                secondaryPhones: opp.secondaryPhones || []
            });
            setTasks(Array.isArray(opp.tasks) ? opp.tasks : []);
            setNotes(Array.isArray(opp.notes) ? opp.notes : []);
            setIsAddingNote(false);
            setEditingNoteId(null);
            setNewNoteContent('');
        } else {
            setEditingId(null);
            setFormData({
                name: '', value: '0', stage: stages[0]?.id || 'New', status: 'Open', source: '',
                contactName: '', contactEmail: '', contactPhone: '', companyName: '',
                your_website: '', budget: '',
                tags: '', calendar: '', contactValue: 'Standard', followUpDate: '',
                opportunityType: '', followUpAssignee: '', meta_campaign: '', meta_adset: '', secondaryPhones: []
            });
            setTasks([]);
            setNotes([]);
            setEditingNoteId(null);
        }
        setActiveTab('details');
        setIsModalOpen(true);
    };

    useEffect(() => {
        const oppId = searchParams.get('oppId');
        if (oppId && opportunities.length > 0 && !isModalOpen) {
            const opp = opportunities.find(o => o.id === oppId);
            if (opp) {
                handleOpenModal(opp);
                // Clean up URL so it doesn't reopen on every refresh
                setSearchParams(new URLSearchParams());
            }
        }
    }, [searchParams, opportunities, isModalOpen]);

    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!formData.contactName) {
            toast.error('Contact Name is required');
            setActiveTab('details');
            return;
        }

        if (!formData.contactPhone) {
            toast.error('Contact Phone Number is required');
            setActiveTab('details');
            return;
        }

        const currentStage = stages.find(s => String(s.id) === String(formData.stage));
        const stageId = String(formData.stage || '').trim();
        const stageTitle = (currentStage?.title || '').toLowerCase();
        
        const isJunkOrNoBudget = 
            stageId === '0' || 
            stageId === '0.5' || 
            stageTitle.includes('junk') || 
            stageTitle.includes('no budget');
            
        const isYetToContact = 
            stageId === '16' || 
            stageTitle.includes('yet to contact');

        if (!formData.followUpAssignee && !isJunkOrNoBudget) {
            toast.error('Follow-up Assignee is required');
            setActiveTab('details');
            return;
        }

        const existingOpp = editingId ? opportunities.find(o => o.id === editingId) : null;
        const isStageChanging = existingOpp && String(formData.stage) !== String(existingOpp.stage);

        // 1. VALIDATION: If stage is not "Yet to contact" (16), "Junk" (0), or "No Budget" (0.5), require Source, Notes, and Follow-up Date
        if (formData.stage && !isYetToContact && !isJunkOrNoBudget) {
            const missing = [];
            if (!formData.source) missing.push('Opportunity Source');
            if (!formData.followUpDate) missing.push('Follow-up Date');
            if (!notes || notes.length === 0) missing.push('at least one Note');

            if (missing.length > 0) {
                toast.error(`Required for this stage: ${missing.join(', ')}`);
                if (missing.some(m => m !== 'at least one Note')) {
                    setActiveTab('details');
                } else {
                    setActiveTab('notes');
                }
                return;
            }
        }

        // 2. NEW ENFORCEMENT: Any stage change requires a NEW note and a follow-up date (EXCEPT for Junk and No Budget)
        const isFollowUpDateChanging = existingOpp && existingOpp.followUpDate !== formData.followUpDate;

        if (isStageChanging && !isJunkOrNoBudget) {
            const todayStr = new Date().toLocaleDateString('en-CA');
            const hasNoteToday = Array.isArray(existingOpp?.notes) && existingOpp.notes.some(note => {
                let noteDate = new Date(0);
                if (note.createdAt) {
                    if (typeof note.createdAt === 'string') noteDate = new Date(note.createdAt);
                    else if (typeof (note.createdAt as any).toDate === 'function') noteDate = (note.createdAt as any).toDate();
                    else noteDate = new Date(note.createdAt as any);
                }
                return !isNaN(noteDate.getTime()) && noteDate.toLocaleDateString('en-CA') === todayStr;
            });

            const hasTaskToday = Array.isArray(existingOpp?.tasks) && existingOpp.tasks.some(task => {
                let taskDate = new Date(0);
                if ((task as any).createdAt) {
                    if (typeof (task as any).createdAt === 'string') taskDate = new Date((task as any).createdAt);
                    else if (typeof ((task as any).createdAt as any).toDate === 'function') taskDate = ((task as any).createdAt as any).toDate();
                    else taskDate = new Date((task as any).createdAt as any);
                } else {
                    const parsedId = parseInt(task.id);
                    if (!isNaN(parsedId) && parsedId > 1000000000000) {
                        taskDate = new Date(parsedId);
                    }
                }
                return !isNaN(taskDate.getTime()) && taskDate.toLocaleDateString('en-CA') === todayStr;
            });

            const hasNewNote = notes.some(note => !existingOpp?.notes?.some(oldNote => oldNote.id === note.id));
            const hasNewTask = tasks.some(task => !existingOpp?.tasks?.some(oldTask => oldTask.id === task.id));

            if (isFollowUpDateChanging) {
                if (!hasNewNote && !hasNewTask) {
                    toast.error('A new note or task is required when changing the follow-up date');
                    setActiveTab('notes');
                    return;
                }
            } else {
                if (!hasNewNote && !hasNewTask && !hasNoteToday && !hasTaskToday) {
                    toast.error('A note or task for today is required for any stage change');
                    setActiveTab('notes');
                    return;
                }
            }

            if (!formData.followUpDate) {
                toast.error('Follow-up Date is required for stage change');
                setActiveTab('details');
                return;
            }
        } else if (isFollowUpDateChanging && !isJunkOrNoBudget) {
            // "if chnge follow up date then add note"
            const hasNewNote = notes.some(note => !existingOpp?.notes?.some(oldNote => oldNote.id === note.id));
            if (!hasNewNote) {
                toast.error('A new note is required when changing the follow-up date');
                setActiveTab('notes');
                return;
            }
        }

        if (isSubmitting) return;
        setIsSubmitting(true);

        let finalContactId = existingOpp?.contactId;

        // Detect if assignee changed to trigger a new notification
        const isNewAssignment = !editingId || (existingOpp && existingOpp.followUpAssignee !== formData.followUpAssignee);

        let finalTasks = [...tasks];
        let finalNotes = [...notes];

        if (editingId && isNewAssignment && existingOpp?.followUpAssignee && formData.followUpAssignee) {
            const oldAssignee = existingOpp.followUpAssignee;
            const newAssignee = formData.followUpAssignee;
            
            // Migrate incomplete tasks
            finalTasks = finalTasks.map(task => {
                if (!task.isCompleted && task.assignee === oldAssignee) {
                    return { ...task, assignee: newAssignee };
                }
                return task;
            });

            // Add a history note
            finalNotes.push({
                id: Date.now().toString(),
                content: `System: Assignee changed from ${oldAssignee} to ${newAssignee}. Incomplete tasks reassigned.`,
                createdAt: new Date().toISOString()
            });
        }

        // Logic to link/create contact
        if (formData.contactName) {
            // 1. Check if contact exists
            const existingContact = contacts.find(c =>
                (formData.contactEmail && c.email === formData.contactEmail) ||
                (c.name.toLowerCase() === formData.contactName.toLowerCase())
            );

            if (existingContact) {
                finalContactId = existingContact.id;
                // Update existing contact's value if it changed
                // Sync Contact Info if changed
                const updates: any = {};
                if (existingContact.Value !== formData.contactValue) updates.Value = formData.contactValue;
                if (existingContact.phone !== formData.contactPhone) updates.phone = formData.contactPhone;
                if (existingContact.email !== formData.contactEmail) updates.email = formData.contactEmail;
                if (existingContact.companyName !== formData.companyName) updates.companyName = formData.companyName;
                if (existingContact.name !== formData.contactName) updates.name = formData.contactName;

                if (Object.keys(updates).length > 0) {
                    await updateContact(existingContact.id, updates);
                    toast.success("Linked contact updated");
                }
            } else {
                // 2. Create new contact
                try {
                    const newContact = await addContact({
                        name: formData.contactName,
                        email: formData.contactEmail || '',
                        phone: formData.contactPhone || '',
                        type: '',
                        companyName: formData.name,
                        owner: currentUser?.id || 'Unknown',
                        Value: (formData.contactValue as 'Standard' | 'Mid' | 'High') || 'Standard'
                    });
                    finalContactId = newContact.id;
                    toast.success(`New contact "${newContact.name}" created`);
                } catch (err) {
                    console.error("Failed to create contact from opportunity", err);
                    toast.error("Failed to create linked contact");
                }
            }
        }

        let autoStatus = formData.status || 'Open';
        const currentStageObj = stages.find(s => String(s.id) === String(formData.stage));
        if (currentStageObj) {
            const stageTitle = currentStageObj.title.toLowerCase();
            if (stageTitle.includes('junk') || stageTitle.includes('no budget') || stageTitle.includes('dead')) {
                autoStatus = 'Abandoned';
            } else if (stageTitle.includes('won') || stageTitle.includes('closed') || stageTitle.includes('success')) {
                autoStatus = 'Won';
            } else {
                autoStatus = 'Open';
            }
        }

        const oppData: any = {
            name: formData.name || 'Website Lead',
            value: Number(formData.value) || 0,
            stage: formData.stage || '16', // Always fallback to 'Yet to contact'
            source: formData.source || '',
            contactName: formData.contactName || '',
            contactEmail: formData.contactEmail || '',
            contactPhone: formData.contactPhone || '',
            companyName: formData.companyName || '',
            your_website: formData.your_website || '',
            budget: formData.budget || '',
            tags: formData.tags ? formData.tags.split(',').map(t => t.trim()).filter(t => t !== '') : [],
            contactId: finalContactId || '',
            calendar: formData.calendar || '',
            status: autoStatus,
            followUpDate: formData.followUpDate || '',
            opportunityType: formData.opportunityType || '',
            followUpAssignee: formData.followUpAssignee || '',
            owner: formData.followUpAssignee || existingOpp?.owner || '', // Sync owner with follow-up assignee
            assignmentNotified: isNewAssignment ? false : (existingOpp?.assignmentNotified ?? false),
            updatedAt: new Date().toISOString(),
            tasks: finalTasks,
            notes: finalNotes,
            secondaryPhones: formData.secondaryPhones || []
        };

        try {
            if (editingId) {
                console.log("Saving Update to Opportunity:", editingId);
                await updateOpportunity(editingId, oppData);
                toast.success('Opportunity updated successfully');
            } else {
                oppData.createdAt = new Date().toISOString();
                await addOpportunity(oppData);
                toast.success('New opportunity created');
            }
            setIsModalOpen(false);
        } catch (error: any) {
            console.error('CRM Save Error:', error);
            toast.error('Could not save: ' + (error.message || 'Permission Denied'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = useCallback(async (id: string) => {
        try {
            await deleteOpportunity(id);
            toast.success('Opportunity deleted successfully');
        } catch (error) {
            console.error("Error deleting opportunity:", error);
            toast.error('Failed to delete opportunity');
        }
    }, [deleteOpportunity]);


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

    const getTimeParts = (time24: string) => {
        const [h, m] = (time24 || '08:00').split(':');
        const hour24 = parseInt(h);
        const hour12 = hour24 % 12 || 12;
        const ampm = hour24 >= 12 ? 'PM' : 'AM';
        return { hour12, minutes: m, ampm };
    };

    const joinTimeParts = (h12: number, min: string, ampm: string) => {
        let h24 = h12 % 12;
        if (ampm === 'PM') h24 += 12;
        return `${h24.toString().padStart(2, '0')}:${min}`;
    };

    // Task & Note Handlers
    const handleAddTask = () => {
        if (!newTaskTitle.trim()) return;

        if (editingTaskId) {
            const updatedTasks = tasks.map(t => t.id === editingTaskId ? {
                ...t,
                title: newTaskTitle,
                description: newTaskDescription,
                dueDate: newTaskDueDate,
                dueTime: newTaskDueTime,
                isRecurring: newTaskIsRecurring,
                assignee: newTaskAssignee,
                assignedBy: currentUser?.email || currentUser?.id, // Track who assigned/updated the task
                // createdBy is preserved from original task (not updated)
            } : t);
            setTasks(updatedTasks);
            setEditingTaskId(null);
        } else {
            const newTask: Task = {
                id: Date.now().toString(),
                title: newTaskTitle,
                description: newTaskDescription,
                dueDate: newTaskDueDate,
                dueTime: newTaskDueTime,
                isRecurring: newTaskIsRecurring,
                assignee: newTaskAssignee,
                assignedBy: currentUser?.email || currentUser?.id, // Track who created the task
                createdBy: currentUser?.email || currentUser?.id, // Track task creator for permissions
                isCompleted: false
            };
            setTasks([...tasks, newTask]);
        }

        setNewTaskTitle('');
        setNewTaskDescription('');
        setNewTaskDueDate(format(new Date(), 'yyyy-MM-dd'));
        setNewTaskDueTime('08:00');
        setNewTaskAssignee('');
        setNewTaskIsRecurring(false);
        setIsAddingTask(false);
    };

    const handleStartEditTask = (task: Task) => {
        setNewTaskTitle(task.title);
        setNewTaskDescription(task.description || '');
        setNewTaskDueDate(task.dueDate || format(new Date(), 'yyyy-MM-dd'));
        setNewTaskDueTime(task.dueTime || '08:00');
        setNewTaskAssignee(task.assignee || '');
        setNewTaskIsRecurring(task.isRecurring || false);
        setEditingTaskId(task.id);
        setIsAddingTask(true);
    };

    const handleDeleteTask = (taskId: string) => {
        setTasks(tasks.filter(t => t.id !== taskId));
    };

    const handleToggleTaskCompletion = async (taskId: string) => {
        let updatedTasks = [] as Task[];
        setTasks(prevTasks => {
            updatedTasks = prevTasks.map(t => {
                if (t.id === taskId) {
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
            return updatedTasks;
        });

        if (editingId) {
            try {
                // Assuming updateOpportunity merges the tasks array
                await updateOpportunity(editingId, { tasks: updatedTasks });
            } catch (error) {
                console.error("Failed to save task completion:", error);
                toast.error("Failed to sync task completion");
            }
        }
    };

    const handleAddNote = () => {
        if (!newNoteContent.trim()) return;

        if (editingNoteId) {
            const updatedNotes = notes.map(n => n.id === editingNoteId ? {
                ...n,
                content: newNoteContent
            } : n);
            setNotes(updatedNotes);
            setEditingNoteId(null);
        } else {
            const newNote: Note = {
                id: Date.now().toString(),
                content: newNoteContent,
                createdAt: new Date().toISOString()
            };
            setNotes([...notes, newNote]);
        }

        setNewNoteContent('');
        setIsAddingNote(false);
    };

    const handleStartEditNote = (note: Note) => {
        setNewNoteContent(note.content);
        setEditingNoteId(note.id);
        setIsAddingNote(true);
    };

    const handleDeleteNote = (noteId: string) => {
        setNotes(notes.filter(n => n.id !== noteId));
    };

    const handleBookAppointment = async () => {
        if (!appointmentForm.title || !appointmentForm.calendar) {
            toast.error('Please fill in all required fields');
            return;
        }

        try {
            await addAppointment({
                title: appointmentForm.title,
                date: appointmentForm.date,
                time: appointmentForm.time,
                assignedTo: currentUser?.id || 'Unknown',
                notes: `Location: ${appointmentForm.location}`,
                contactId: editingId || undefined // Associate with this opportunity if possible, or just create generic
            });
            toast.success('Appointment booked successfully');
            setAppointmentForm({
                calendar: '',
                location: '',
                title: '',
                date: format(new Date(), 'yyyy-MM-dd'),
                time: '09:00'
            });
        } catch (error) {
            toast.error('Failed to book appointment');
        }
    };


    // Pipeline Management
    const handleSavePipeline = () => {
        updateStages(tempStages);
        setIsPipelineModalOpen(false);
        toast.success('Pipeline updated successfully');
    };

    const handleAddStage = () => {
        setTempStages([...tempStages, { id: `Stage ${tempStages.length + 1}`, title: 'New Stage', color: '#cccccc' }]);
    };

    const handleRemoveStage = (index: number) => {
        const newStages = [...tempStages];
        newStages.splice(index, 1);
        setTempStages(newStages);
    };

    const handleStageChange = (index: number, field: 'title' | 'color', value: string) => {
        const newStages = [...tempStages];
        newStages[index] = { ...newStages[index], [field]: value, id: field === 'title' ? value : newStages[index].id };
        setTempStages(newStages);
    };

    // Import Handler
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const rows = results.data as any[];
                let successCount = 0;
                let errorCount = 0;
                const toastId = toast.loading('Importing opportunities...');

                for (const row of rows) {
                    try {
                        if (Object.values(row).every(x => !x)) continue;

                        const normalizedRow: any = {};
                        Object.keys(row).forEach(key => {
                            normalizedRow[key.toLowerCase().trim()] = row[key];
                        });

                        const name = normalizedRow['opportunity name'] || normalizedRow['opportunity'] || normalizedRow['name'] || normalizedRow['title'];
                        if (!name) {
                            errorCount++;
                            continue;
                        }

                        // Extract contact info
                        const contactName = normalizedRow['contact name'] || normalizedRow['contact'];
                        const contactEmail = normalizedRow['email'] || normalizedRow['contact email'];
                        const contactPhone = normalizedRow['phone'] || normalizedRow['contact phone'];
                        const contactValue = normalizedRow['contact value'] || 'Standard';

                        let finalContactId: string | undefined = undefined;

                        // Try to link or create contact
                        if (contactName || contactEmail) {
                            const existingContact = contacts.find(c =>
                                (contactEmail && c.email === contactEmail) ||
                                (contactName && c.name.toLowerCase() === contactName.toLowerCase())
                            );

                            if (existingContact) {
                                finalContactId = existingContact.id;
                                // Sync Data for imported contacts
                                const updates: any = {};
                                if (contactValue && existingContact.Value !== contactValue) updates.Value = contactValue;
                                if (contactPhone && existingContact.phone !== contactPhone) updates.phone = contactPhone;

                                // Mapping Opportunity Name to Company Name
                                if (name && existingContact.companyName !== name) updates.companyName = name;

                                if (Object.keys(updates).length > 0) {
                                    await updateContact(existingContact.id, updates);
                                }
                            } else if (contactName) {
                                // Create new contact if not found
                                try {
                                    const newContact = await addContact({
                                        name: contactName,
                                        email: contactEmail || '',
                                        phone: contactPhone || '',
                                        type: '',
                                        companyName: name,
                                        owner: currentUser?.id || 'Unknown',
                                        Value: contactValue
                                    });
                                    finalContactId = newContact.id;
                                } catch (e) {
                                    console.error("Failed to create simple contact during import", e);
                                }
                            }
                        }

                        // Determine Stage
                        const stageName = normalizedRow['stage'];
                        let validStageId = stages[0]?.id || 'New';
                        if (stageName) {
                            const foundStage = stages.find(s => s.title.toLowerCase() === stageName.toLowerCase() || s.id === stageName);
                            if (foundStage) validStageId = foundStage.id;
                        }

                        const oppData: any = {
                            name: name,
                            value: Number(normalizedRow['value'] || 0),
                            stage: validStageId,
                            status: (normalizedRow['status'] || 'Open'),
                            source: normalizedRow['source'] || '',
                            contactName: contactName || '',
                            contactEmail: contactEmail || '',
                            contactPhone: contactPhone || '',
                            companyName: normalizedRow['company name'] || normalizedRow['company'] || '',
                            contactId: finalContactId,
                            tags: normalizedRow['tags'] ? normalizedRow['tags'].split(',').map((t: string) => t.trim()) : [],
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        };

                        await addOpportunity(oppData);
                        successCount++;
                    } catch (err) {
                        console.error("Error importing row:", row, err);
                        errorCount++;
                    }
                }

                toast.dismiss(toastId);
                if (successCount > 0) toast.success(`Successfully imported ${successCount} opportunities`);
                if (errorCount > 0) toast.error(`Failed to import ${errorCount} opportunities`);

                event.target.value = '';
            },
            error: (error) => {
                toast.error('Failed to parse CSV file');
                console.error(error);
            }
        });
    };

    const handleExport = () => {
        if (visibleOpportunities.length === 0) {
            toast.error('No opportunities to export');
            return;
        }

        const csvData = visibleOpportunities.map(opp => ({
            'Opportunity Name': opp.name,
            'Opportunity Type': opp.opportunityType || '',
            'Value': opp.value,
            'Stage': stages.find(s => s.id === opp.stage)?.title || opp.stage,
            'Notes': opp.notes && opp.notes.length > 0 ? (opp.notes[opp.notes.length - 1] as any).content : '',
            'Source': opp.source,
            'Contact Name': opp.contactName,
            'Contact Email': opp.contactEmail,
            'Contact Phone': opp.contactPhone,
            'Company Name': opp.companyName,
            'Status': opp.status,
            'Created At': opp.createdAt,
            'Updated At': opp.updatedAt
        }));

        const csvString = Papa.unparse(csvData);
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `opportunities_export_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleAnalyzePotential = async () => {
        try {
            setIsAnalyzingPotential(true);
            toast.loading('Analyzing potential of open leads...', { id: 'analyzePotential' });
            const analyzeFunc = httpsCallable(functions, 'analyzeOpenLeadsPotential');
            const result: any = await analyzeFunc();
            toast.success(`Analyzed open leads. Updated ${result.data?.updatedCount || 0} leads.`, { id: 'analyzePotential' });
            fetchOpportunities();
        } catch (error) {
            console.error('Error analyzing potential:', error);
            toast.error('Failed to analyze potential', { id: 'analyzePotential' });
        } finally {
            setIsAnalyzingPotential(false);
        }
    };

    return (
        <div className="p-4 md:p-8 h-full flex flex-col bg-gray-50/50">
            {/* Header */}
            <div className="flex flex-col gap-4 mb-4 md:mb-6 shrink-0">
                <div className="flex justify-between items-center">
                    <h1 className="text-xl md:text-3xl font-bold text-gray-900">Opportunities</h1>
                    <div className="flex gap-2 md:gap-3">
                        <button
                            onClick={() => setIsPipelineModalOpen(true)}
                            className="hidden md:block px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50 shadow-sm"
                        >
                            Pipelines
                        </button>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="hidden md:block px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50 shadow-sm"
                        >
                            Import
                        </button>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleImport}
                            accept=".csv"
                            className="hidden"
                        />
                        <button
                            onClick={handleExport}
                            className="hidden md:flex px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50 shadow-sm items-center gap-2"
                        >
                            <Download size={16} /> Export ({visibleOpportunities.length})
                        </button>
                        <button
                            onClick={handleAnalyzePotential}
                            disabled={isAnalyzingPotential}
                            className={`hidden md:flex px-4 py-2 ${isAnalyzingPotential ? 'bg-yellow-50 text-yellow-400 cursor-not-allowed' : 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'} border border-yellow-200 rounded-lg text-sm font-bold shadow-sm items-center gap-2`}
                        >
                            <Star size={16} className={isAnalyzingPotential ? 'animate-spin' : ''} />
                            {isAnalyzingPotential ? 'Analyzing...' : 'Analyze Potential'}
                        </button>
                        <button
                            onClick={handleSalestrailSync}
                            disabled={isSyncingSalestrail}
                            className={`px-3 md:px-4 py-2 ${isSyncingSalestrail ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-brand-blue text-white hover:bg-brand-blue/90'} rounded-lg text-sm font-bold shadow-sm flex items-center gap-2`}
                        >
                            <RefreshCw size={18} className={isSyncingSalestrail ? 'animate-spin' : ''} />
                            <span className="hidden md:inline">{isSyncingSalestrail ? 'Syncing...' : 'Sync Salestrail'}</span>
                            <span className="md:hidden">Sync</span>
                        </button>
                        <button
                            onClick={() => handleOpenModal()}
                            className="px-3 md:px-4 py-2 bg-brand-orange text-white rounded-lg text-sm font-bold hover:bg-brand-orange/90 shadow-sm flex items-center gap-2"
                        >
                            <Plus size={18} /> <span className="hidden md:inline">Add Opportunity</span><span className="md:hidden">Add</span>
                        </button>
                    </div>
                </div>

                {/* Bulk Action Bar */}
                {selectedIds.size > 0 && viewMode === 'list' && (
                    <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg flex items-center justify-between animate-in fade-in slide-in-from-top-2 shrink-0">
                        <span className="text-sm font-medium text-blue-800">{selectedIds.size} opportunities selected</span>
                        <div className="flex gap-2">
                            <button
                                onClick={handleBulkDelete}
                                className="px-3 py-1.5 bg-white border border-red-300 text-red-700 rounded text-sm font-medium hover:bg-red-50"
                            >
                                Delete Selected
                            </button>
                            <button
                                onClick={() => setSelectedIds(new Set())}
                                className="px-3 py-1.5 text-gray-500 hover:text-gray-700 text-sm"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {/* Filters Bar */}
                <div className="flex flex-wrap md:flex-nowrap gap-2 md:gap-4 items-center relative">
                    {/* Lead filter tabs */}
                    <div className="flex bg-white border border-gray-300 rounded-lg p-1 shrink-0 shadow-sm">
                        <button
                            onClick={() => setLeadFilter('all')}
                            className={`px-3 py-1.5 rounded-md text-xs md:text-sm font-bold transition-all ${leadFilter === 'all' ? 'bg-brand-blue text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                        >
                            All Leads
                        </button>
                        <button
                            onClick={() => setLeadFilter('assigned')}
                            className={`px-3 py-1.5 rounded-md text-xs md:text-sm font-bold transition-all ${leadFilter === 'assigned' ? 'bg-brand-blue text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                        >
                            Assigned to Me
                        </button>
                        <button
                            onClick={() => setLeadFilter('unassigned')}
                            className={`px-3 py-1.5 rounded-md text-xs md:text-sm font-bold transition-all ${leadFilter === 'unassigned' ? 'bg-brand-blue text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                        >
                            Unassigned
                        </button>
                    </div>

                    <div className="relative flex-1 min-w-[200px] md:max-w-md">
                        <Search className="absolute left-3 top-2.5 text-gray-400 h-5 w-5" />
                        <input
                            type="text"
                            placeholder="Search Opportunities"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue"
                        />
                    </div>
                    <div className="flex bg-white border border-gray-300 rounded-lg p-1 shrink-0 shadow-sm">
                        <button
                            onClick={() => setViewMode('board')}
                            className={`p-1.5 md:p-2 rounded ${viewMode === 'board' ? 'bg-gray-100 text-brand-blue' : 'text-gray-500 hover:text-gray-700'}`}
                            title="Board View"
                        >
                            <LayoutGrid size={18} className="md:w-5 md:h-5" />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-1.5 md:p-2 rounded ${viewMode === 'list' ? 'bg-gray-100 text-brand-blue' : 'text-gray-500 hover:text-gray-700'}`}
                            title="List View"
                        >
                            <ListIcon size={18} className="md:w-5 md:h-5" />
                        </button>
                        {isUserAdmin(currentUser?.email) && (
                            <button
                                onClick={() => setViewMode('analytics' as any)}
                                className={`p-1.5 md:p-2 rounded ${viewMode === 'analytics' as any ? 'bg-gray-100 text-brand-blue' : 'text-gray-500 hover:text-gray-700'}`}
                                title="Team Analytics"
                            >
                                <BarChart size={18} className="md:w-5 md:h-5" />
                            </button>
                        )}
                    </div>

                    {/* Quick Status Filters */}
                    <div className="flex bg-white border border-gray-300 rounded-lg p-1 shrink-0 shadow-sm overflow-x-auto no-scrollbar">
                        {[
                            { label: 'All', value: '' },
                            { label: 'Open', value: 'Open' },
                            { label: 'Won', value: 'Won' },
                            { label: 'Lost', value: 'Lost' },
                            { label: 'Not Answered', value: 'Not Answered' }
                        ].map((s) => (
                            <button
                                key={s.label}
                                onClick={() => setFilters(prev => ({ ...prev, status: s.value }))}
                                className={`px-3 py-1.5 rounded text-xs font-bold whitespace-nowrap transition-colors ${
                                    filters.status === s.value 
                                        ? 'bg-brand-blue text-white' 
                                        : 'text-gray-500 hover:bg-gray-50'
                                }`}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                    <div className="relative" ref={sortRef}>
                        <button
                            onClick={() => setIsSortOpen(!isSortOpen)}
                            className={`px-3 py-2 border rounded-lg flex items-center gap-2 text-sm font-medium ${isSortOpen ? 'bg-blue-50 border-brand-blue text-brand-blue' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                        >
                            <ArrowUpDown size={18} />
                            Sort: {
                                sortBy === 'none' ? 'Default' :
                                    sortBy === 'stage' ? (sortOrder === 'asc' ? 'Stage Asc' : 'Stage Desc') :
                                        sortBy === 'followUp' ? (sortOrder === 'asc' ? 'Follow up: Nearest' : 'Follow up: Furthest') :
                                            (sortOrder === 'asc' ? 'Date Asc' : 'Date Desc')
                            }
                        </button>

                        {isSortOpen && (
                            <div className="absolute left-0 top-full mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-200 z-50 py-2 animate-in fade-in slide-in-from-top-2">
                                <button
                                    onClick={() => { setSortBy('none'); setIsSortOpen(false); }}
                                    className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${sortBy === 'none' ? 'text-brand-blue font-bold bg-blue-50' : 'text-gray-700'}`}
                                >
                                    Reset to Default Order
                                </button>
                                <div className="my-1 border-t border-gray-100" />
                                <button
                                    onClick={() => { setSortBy('stage'); setSortOrder('asc'); setIsSortOpen(false); }}
                                    className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${sortBy === 'stage' && sortOrder === 'asc' ? 'text-brand-blue font-bold bg-blue-50' : 'text-gray-700'}`}
                                >
                                    Stage: Ascending (0 → 21)
                                </button>
                                <button
                                    onClick={() => { setSortBy('stage'); setSortOrder('desc'); setIsSortOpen(false); }}
                                    className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${sortBy === 'stage' && sortOrder === 'desc' ? 'text-brand-blue font-bold bg-blue-50' : 'text-gray-700'}`}
                                >
                                    Stage: Descending (21 → 0)
                                </button>
                                <div className="my-1 border-t border-gray-100" />
                                <button
                                    onClick={() => { setSortBy('followUp'); setSortOrder('asc'); setIsSortOpen(false); }}
                                    className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${sortBy === 'followUp' && sortOrder === 'asc' ? 'text-brand-blue font-bold bg-blue-50' : 'text-gray-700'}`}
                                >
                                    Follow up: Nearest First
                                </button>
                                <button
                                    onClick={() => { setSortBy('followUp'); setSortOrder('desc'); setIsSortOpen(false); }}
                                    className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${sortBy === 'followUp' && sortOrder === 'desc' ? 'text-brand-blue font-bold bg-blue-50' : 'text-gray-700'}`}
                                >
                                    Follow up: Furthest First
                                </button>
                                <div className="my-1 border-t border-gray-100" />
                                <button
                                    onClick={() => { setSortBy('date'); setSortOrder('asc'); setIsSortOpen(false); }}
                                    className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${sortBy === 'date' && sortOrder === 'asc' ? 'text-brand-blue font-bold bg-blue-50' : 'text-gray-700'}`}
                                >
                                    Created Date: Oldest First
                                </button>
                                <button
                                    onClick={() => { setSortBy('date'); setSortOrder('desc'); setIsSortOpen(false); }}
                                    className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${sortBy === 'date' && sortOrder === 'desc' ? 'text-brand-blue font-bold bg-blue-50' : 'text-gray-700'}`}
                                >
                                    Created Date: Newest First
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="relative" ref={filterRef}>
                        <button
                            onClick={() => setIsFilterOpen(!isFilterOpen)}
                            className={`px-3 py-2 border rounded-lg flex items-center gap-2 text-sm font-medium ${isFilterOpen || filters.stage.length > 0 || filters.status || filters.opportunityType || filters.selectedMonth || filters.assignee || filters.source ? 'bg-blue-50 border-brand-blue text-brand-blue' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                        >
                            <Filter size={18} /> Filters {(filters.stage.length > 0 || filters.status || filters.opportunityType || filters.selectedMonth || filters.assignee || filters.source) && <span className="w-2 h-2 rounded-full bg-brand-blue mb-2"></span>}
                        </button>

                        {/* Filter Dropdown */}
                        {isFilterOpen && (
                            <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-200 z-50 p-4 space-y-4 animate-in fade-in slide-in-from-top-2">
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 mb-2">Stages</label>
                                    <div className="max-h-48 overflow-y-auto space-y-1 custom-scrollbar pr-2 border border-gray-100 rounded-lg p-2 bg-gray-50/50">
                                        <label className="flex items-center gap-2 cursor-pointer hover:bg-white p-1.5 rounded transition-colors group">
                                            <input
                                                type="checkbox"
                                                checked={filters.stage.length === 0}
                                                onChange={() => setFilters(prev => ({ ...prev, stage: [] }))}
                                                className="w-4 h-4 text-brand-blue border-gray-300 rounded focus:ring-brand-blue"
                                            />
                                            <span className={`text-sm ${filters.stage.length === 0 ? 'text-brand-blue font-bold' : 'text-gray-600'}`}>All Stages</span>
                                        </label>
                                        <div className="my-1 border-t border-gray-200/50" />
                                        {[...stages].sort((a, b) => getStageRank(a.title) - getStageRank(b.title)).map(s => (
                                            <label key={s.id} className="flex items-center gap-2 cursor-pointer hover:bg-white p-1.5 rounded transition-colors group">
                                                <input
                                                    type="checkbox"
                                                    checked={filters.stage.includes(s.id)}
                                                    onChange={(e) => {
                                                        const newStages = e.target.checked
                                                            ? [...filters.stage, s.id]
                                                            : filters.stage.filter(id => id !== s.id);
                                                        setFilters(prev => ({ ...prev, stage: newStages }));
                                                    }}
                                                    className="w-4 h-4 text-brand-blue border-gray-300 rounded focus:ring-brand-blue"
                                                />
                                                <span className={`text-sm ${filters.stage.includes(s.id) ? 'text-brand-blue font-medium' : 'text-gray-600'}`}>{s.title}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 mb-1">Status</label>
                                    <select
                                        value={filters.status}
                                        onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                                        className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:ring-brand-blue focus:border-brand-blue"
                                    >
                                        <option value="">All Statuses</option>
                                        <option value="Open">Open</option>
                                        <option value="Won">Won</option>
                                        <option value="Lost">Lost</option>
                                        <option value="Abandoned">Abandoned</option>
                                        <option value="Not Answered">Not Answered</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 mb-1">Type</label>
                                    <select
                                        value={filters.opportunityType}
                                        onChange={(e) => setFilters(prev => ({ ...prev, opportunityType: e.target.value }))}
                                        className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:ring-brand-blue focus:border-brand-blue"
                                    >
                                        <option value="">All Types</option>
                                        <option value="Real Estate">Real Estate</option>
                                        <option value="adcalculator">Ad Calculator</option>
                                        <option value="free audit landing page">Free Audit Landing Page</option>
                                        <option value="Meta Ads">Meta Ads</option>
                                        <option value="Others">Others</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 mb-1">Month</label>
                                    <input
                                        type="month"
                                        value={filters.selectedMonth}
                                        onChange={(e) => setFilters(prev => ({ ...prev, selectedMonth: e.target.value }))}
                                        className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:ring-brand-blue focus:border-brand-blue"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 mb-1">Assignee</label>
                                    <select
                                        value={filters.assignee}
                                        onChange={(e) => setFilters(prev => ({ ...prev, assignee: e.target.value }))}
                                        className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:ring-brand-blue focus:border-brand-blue"
                                    >
                                        <option value="">All Assignees</option>
                                        <option value="Dhiraj">Dhiraj</option>
                                        <option value="Srishti">Srishti</option>
                                        <option value="Rupal">Rupal</option>
                                        <option value="Veda">Veda</option>
                                        <option value="Komal">Komal</option>
                                        <option value="Aditya">Aditya</option>
                                        <option value="Anshita">Anshita</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 mb-1">Source</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. meta, organic..."
                                        value={filters.source}
                                        onChange={(e) => setFilters(prev => ({ ...prev, source: e.target.value }))}
                                        className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:ring-brand-blue focus:border-brand-blue"
                                    />
                                </div>
                                <div className="pt-2 border-t border-gray-100 flex justify-between items-center">
                                    <div className="flex gap-3 items-center">
                                        <button
                                            onClick={() => setFilters({ stage: [], status: '', opportunityType: '', selectedMonth: '', assignee: '', source: '', meta_campaign: '', meta_adset: '' })}
                                            className="text-xs text-red-600 hover:text-red-700 font-medium"
                                        >
                                            Clear Filters
                                        </button>
                                        {(filters.stage.length > 0 || filters.status || filters.opportunityType || filters.selectedMonth || filters.assignee || filters.source || searchTerm) && (
                                            <button
                                                onClick={handleExport}
                                                className="text-xs text-brand-blue hover:text-brand-blue/80 font-bold flex items-center gap-1"
                                            >
                                                <Download size={14} /> Download Results
                                            </button>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => setIsFilterOpen(false)}
                                        className="px-3 py-1.5 bg-brand-blue text-white rounded text-xs font-bold hover:bg-brand-blue/90"
                                    >
                                        Done
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 overflow-hidden px-4 md:px-0">
                {viewMode === 'board' ? (
                    <DndContext onDragEnd={handleDragEnd} sensors={sensors}>
                        <div className="h-full overflow-x-auto overflow-y-hidden md:custom-scrollbar pb-4 md:px-1 snap-x snap-mandatory scroll-smooth">
                            {/* Desktop/Tablet Board View & Mobile Slider */}
                            <div className="flex h-full gap-4 min-w-max md:px-1">
                                {sortedStages.filter(stage => filters.stage.length === 0 || filters.stage.includes(stage.id)).map(stage => {
                                    const stageOpps = visibleOpportunities.filter(o => o.stage === stage.id);
                                    const isFiltered = !!(searchTerm.trim() || filters.stage.length > 0 || filters.status || filters.opportunityType);

                                    return (
                                        <div key={stage.id} className="w-[85vw] md:w-80 snap-center md:snap-align-none shrink-0 h-full">
                                            <DroppableColumn
                                                stage={stage}
                                                items={stageOpps}
                                                onEdit={handleOpenModal}
                                                onDelete={handleDelete}
                                                hasMore={stagePagination[stage.id]?.hasMore ?? true}
                                                onLoadMore={() => loadMoreByStage(stage.id)}
                                                isLoading={stagePagination[stage.id]?.isLoading ?? false}
                                                totalCount={isFiltered ? stageOpps.length : (stageCounts[stage.id]?.count || 0)}
                                                totalValue={isFiltered ? stageOpps.reduce((sum, o) => sum + (Number(o.value) || 0), 0) : (stageCounts[stage.id]?.value || 0)}
                                                appointments={appointments}
                                                onScoreSingleLead={handleScoreSingleLead}
                                                scoringLeads={scoringLeads}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </DndContext>
                ) : viewMode === 'analytics' ? (
                    <AnalyticsDashboard opportunities={opportunities} stages={stages} />
                ) : (
                    // List View
                    <div className="bg-white md:border border-gray-200 rounded-lg md:shadow-sm overflow-hidden flex flex-col h-full bg-gray-50/30 md:bg-white">
                        <div ref={listScrollContainerRef} className="overflow-auto flex-1">
                            {/* Desktop Table View */}
                            <table className="hidden md:table w-full text-sm text-left text-gray-500">
                                <thead className="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0 z-10">
                                    <tr>
                                        <th className="p-4 w-4">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.size === visibleOpportunities.length && visibleOpportunities.length > 0}
                                                onChange={handleSelectAll}
                                                className="w-4 h-4 text-brand-blue bg-gray-100 border-gray-300 rounded focus:ring-brand-blue"
                                            />
                                        </th>
                                        <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Opportunity</th>
                                        <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Contact</th>
                                        <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Phone</th>
                                        <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Notes</th>
                                        <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Next Follow up Date</th>
                                        <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Source</th>
                                        <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Stage</th>
                                        <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Calls</th>
                                        <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Value</th>
                                        <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Email</th>
                                        <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Status</th>
                                        <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Created On</th>
                                        <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {visibleOpportunities.map((opp) => (
                                        <tr key={opp.id} className={`hover:bg-gray-50 transition-colors group cursor-pointer ${selectedIds.has(opp.id) ? 'bg-blue-50/50' : ''}`} onClick={() => handleOpenModal(opp)}>
                                            <td className="p-4" onClick={e => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(opp.id)}
                                                    onChange={() => handleSelectOne(opp.id)}
                                                    className="rounded border-gray-300 text-brand-blue focus:ring-brand-blue"
                                                />
                                            </td>
                                            <td className="p-4 font-medium text-brand-blue">{opp.companyName || opp.name}</td>
                                            <td className="p-4">
                                                {opp.contactName ? (
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">
                                                            {opp.contactName.charAt(0)}
                                                        </div>
                                                        <span className="text-sm text-gray-700">{opp.contactName}</span>
                                                    </div>
                                                ) : <span className="text-gray-400 text-sm">-</span>}
                                            </td>
                                            <td className="p-4 text-sm text-gray-600">{opp.contactPhone || '-'}</td>
                                            <td className="p-4 text-sm text-gray-600 relative group/note">
                                                {(() => {
                                                    const latestNoteObj = opp.notes && opp.notes.length > 0
                                                        ? ([...opp.notes].sort((a, b) => new Date((b as any).createdAt).getTime() - new Date((a as any).createdAt).getTime())[0] as any)
                                                        : null;
                                                    const latestNoteContent = latestNoteObj ? latestNoteObj.content : '-';
                                                    return (
                                                        <>
                                                            <div className="truncate max-w-[200px]">{latestNoteContent}</div>
                                                            {latestNoteObj && (
                                                                <div className="absolute z-50 invisible group-hover/note:visible bg-gray-900 text-white p-3 rounded-lg shadow-xl text-xs -top-2 left-3/4 ml-2 w-72 break-words pointer-events-none">
                                                                    <div className="font-bold mb-1 text-blue-400">
                                                                        {safeFormat(latestNoteObj.createdAt, 'MMM d, h:mm a')}
                                                                    </div>
                                                                    {latestNoteContent}
                                                                    <div className="absolute top-4 -left-1 w-2 h-2 bg-gray-900 rotate-45"></div>
                                                                </div>
                                                            )}
                                                        </>
                                                    );
                                                })()}
                                            </td>
                                            <td className="p-4 text-sm text-gray-600">
                                                {opp.followUpDate ? safeFormat(opp.followUpDate, 'MMM d, yyyy') : '-'}
                                            </td>
                                            <td className="p-4 text-sm text-gray-600">
                                                {opp.source || '-'}
                                            </td>
                                            <td className="p-4">
                                                <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-medium border border-gray-200">
                                                    {stages.find(s => s.id === opp.stage)?.title || opp.stage}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                {opp.calls && opp.calls.length > 0 ? (
                                                    <div className="flex items-center gap-1 text-orange-600 font-bold text-xs">
                                                        <Phone size={12} />
                                                        <span>{opp.calls.length}</span>
                                                    </div>
                                                ) : <span className="text-gray-300">-</span>}
                                            </td>
                                            <td className="p-4 text-sm text-gray-700">₹{Number(opp.value).toLocaleString()}</td>
                                            <td className="p-4 text-sm text-gray-600">{opp.contactEmail || '-'}</td>
                                            <td className="p-4">
                                                <span className={`px-2 py-1 text-xs font-medium rounded-full border ${opp.status === 'Won' ? 'bg-green-50 text-green-700 border-green-100' :
                                                    opp.status === 'Lost' ? 'bg-red-50 text-red-700 border-red-100' :
                                                        opp.status === 'Abandoned' ? 'bg-gray-50 text-gray-700 border-gray-100' :
                                                            opp.status === 'Not Answered' ? 'bg-orange-50 text-orange-700 border-orange-100' :
                                                                'bg-blue-50 text-blue-700 border-blue-100'
                                                    }`}>
                                                    {opp.status}
                                                </span>
                                            </td>
                                            <td className="p-4 text-sm text-gray-500">
                                                {opp.createdAt ? safeFormat(opp.createdAt, 'MMM d, yyyy h:mm a') : '-'}
                                            </td>
                                            <td className="p-4 text-right" onClick={e => e.stopPropagation()}>
                                                <button onClick={() => handleDelete(opp.id)} className="text-gray-400 hover:text-red-600 p-1">
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {/* Sentinel row for infinite scroll */}
                                    <tr ref={listLoadMoreRef}>
                                        <td colSpan={14} className="h-4">
                                            {isLoading && hasMoreOpportunities && (
                                                <div className="flex justify-center py-4">
                                                    <div className="w-6 h-6 border-2 border-brand-blue border-t-transparent rounded-full animate-spin"></div>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>

                            {/* Mobile Card List View */}
                            <div className="md:hidden flex flex-col gap-4 p-1 pb-24">
                                {visibleOpportunities.map((opp) => (
                                    <div
                                        key={opp.id}
                                        onClick={() => handleOpenModal(opp)}
                                        className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 active:scale-[0.98] transition-transform"
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <h4 className="font-bold text-gray-900 leading-tight">{opp.companyName || opp.name}</h4>
                                                <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                                                    <Tag size={12} /> {stages.find(s => s.id === opp.stage)?.title || opp.stage}
                                                </p>
                                            </div>
                                            <span className="text-sm font-bold text-brand-orange">₹{Number(opp.value).toLocaleString()}</span>
                                        </div>
                                        <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 pt-3 border-t border-gray-50">
                                            <div className="flex items-center gap-2 text-[11px] text-gray-600">
                                                <User size={12} className="text-gray-400" /> {opp.contactName || 'No contact'}
                                            </div>
                                            <div className="flex items-center gap-2 text-[11px] text-gray-600">
                                                <Calendar size={12} className="text-gray-400" /> {opp.followUpDate ? safeFormat(opp.followUpDate, 'MMM d') : 'No follow-up'}
                                            </div>
                                            {opp.status && (
                                                <div className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${opp.status === 'Won' ? 'bg-green-100 text-green-700' :
                                                    opp.status === 'Lost' ? 'bg-red-100 text-red-700' :
                                                    opp.status === 'Not Answered' ? 'bg-orange-100 text-orange-700' :
                                                    'bg-blue-100 text-blue-700'
                                                    }`}>
                                                    {opp.status}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {isLoading && hasMoreOpportunities && (
                                    <div className="flex justify-center py-4" ref={listLoadMoreRef}>
                                        <div className="w-6 h-6 border-2 border-brand-blue border-t-transparent rounded-full animate-spin"></div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center text-sm text-gray-500">
                            <span>Showing {visibleOpportunities.length} opportunities {hasMoreOpportunities && '(scroll for more)'}</span>
                            {isLoading && (
                                <div className="flex items-center gap-2 text-brand-blue">
                                    <div className="w-4 h-4 border-2 border-brand-blue border-t-transparent rounded-full animate-spin"></div>
                                    <span>Loading...</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Enhanced Opportunity Modal */}
            {
                isModalOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-4">
                        <div className="bg-white w-full h-full md:max-w-7xl md:h-[95vh] md:rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                            {/* Modal Header */}
                            <div className="flex justify-between items-center px-4 md:px-6 py-4 border-b border-gray-200 bg-white shrink-0">
                                <h2 className="text-lg md:text-xl font-bold text-gray-900">
                                    {editingId ? `Edit ${formData.name}` : 'New Opportunity'}
                                </h2>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleSubmit}
                                        disabled={isSubmitting}
                                        className="md:hidden px-4 py-2 bg-brand-orange text-white rounded-lg text-sm font-bold hover:bg-brand-orange/90 shadow-sm disabled:opacity-50"
                                    >
                                        {isSubmitting ? '...' : (editingId ? 'Update' : 'Create')}
                                    </button>
                                    <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                                        <X size={24} />
                                    </button>
                                </div>
                            </div>

                            <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
                                {/* Sidebar Tabs / Top Tabs on Mobile */}
                                <div className="w-full md:w-64 bg-gray-50 border-b md:border-b-0 md:border-r border-gray-200 flex md:flex-col overflow-x-auto md:overflow-y-auto shrink-0 no-scrollbar">
                                    {(() => {
                                        const tabs = [
                                            { label: 'Details', id: 'details' },
                                            { label: 'Booking', id: 'book-update-appointment' },
                                            { label: 'Notes', id: 'notes' },
                                            { label: 'Calls', id: 'calls' },
                                            { label: 'Discovery Form', id: 'discovery' },
                                            { label: 'Voice Agent Input', id: 'voice-agent' }
                                        ];
                                        if (isUserAdmin(currentUser?.email)) {
                                            tabs.push({ label: 'Leads Movement', id: 'activity' });
                                        }
                                        return tabs.map((tab) => (
                                            <button
                                                key={tab.id}
                                                onClick={() => setActiveTab(tab.id)}
                                                className={`px-4 md:px-6 py-3 md:py-4 text-left text-xs md:text-sm font-bold whitespace-nowrap border-b-2 md:border-b-0 md:border-l-4 transition-colors ${activeTab === tab.id || (tab.id === 'details' && activeTab === 'opportunity-details')
                                                    ? 'bg-blue-50 border-brand-blue text-brand-blue'
                                                    : 'border-transparent text-gray-600 hover:bg-gray-100'
                                                    }`}
                                            >
                                                {tab.label}
                                            </button>
                                        ));
                                    })()}
                                </div>

                                {/* Main Content Area */}
                                <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
                                    <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-white lg:border-r border-gray-200">
                                        <div className="max-w-4xl mx-auto space-y-6 md:space-y-8 pb-10">
                                        {/* DETAILS TAB */}
                                        {(activeTab === 'details' || activeTab === 'opportunity-details') && (
                                            <>
                                                {/* Contact Details Section */}
                                                <section>
                                                    <div className="flex justify-between items-center mb-4">
                                                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                                            Contact details <User size={18} className="text-gray-400" />
                                                        </h3>
                                                        {editingId && (() => {
                                                            const currentOpp = opportunities.find(o => o.id === editingId);
                                                            return (
                                                                <div className="flex flex-col items-end">
                                                                    <button
                                                                        onClick={handleSendSalesAssets}
                                                                        disabled={isSendingAssets}
                                                                        className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 shadow-sm transition-all disabled:opacity-50"
                                                                    >
                                                                        <Zap size={14} className={isSendingAssets ? 'animate-pulse' : ''} />
                                                                        {isSendingAssets ? 'Sending Assets...' : 'Send Sales Assets'}
                                                                    </button>
                                                                    {currentOpp?.lastSalesAssetsSent && (
                                                                        <span className="text-[10px] text-gray-500 mt-1 font-medium">
                                                                            Last sent: {safeFormat(currentOpp.lastSalesAssetsSent, 'MMM d, h:mm a')}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                    <div className="space-y-4 md:space-y-6">
                                                        <div className="relative">
                                                            <div className="flex justify-between items-center mb-1">
                                                                <span className="text-xs font-medium text-gray-500">Contact Name <span className="text-red-500">*</span></span>
                                                            </div>
                                                            <div className="relative">
                                                                <User className="absolute left-3 top-2.5 text-gray-400 h-5 w-5" />
                                                                <input
                                                                    type="text"
                                                                    placeholder="Contact Name *"
                                                                    value={formData.contactName}
                                                                    onChange={e => setFormData({ ...formData, contactName: e.target.value })}
                                                                    className="w-full pl-10 p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                                                            <div className="relative">
                                                                <Mail className="absolute left-3 top-2.5 text-gray-400 h-5 w-5" />
                                                                <input
                                                                    type="email"
                                                                    placeholder="Email Address"
                                                                    value={formData.contactEmail}
                                                                    onChange={e => setFormData({ ...formData, contactEmail: e.target.value })}
                                                                    className="w-full pl-10 p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                                />
                                                            </div>
                                                            <div className="relative">
                                                                <div className="flex justify-between items-center mb-1">
                                                                    <span className="text-xs font-medium text-gray-500">Phone Number <span className="text-red-500">*</span></span>
                                                                </div>
                                                                <div className="relative">
                                                                    <Phone className="absolute left-3 top-2.5 text-gray-400 h-5 w-5" />
                                                                    <input
                                                                        type="tel"
                                                                        placeholder="Phone Number *"
                                                                        value={formData.contactPhone}
                                                                        onChange={e => {
                                                                            const val = e.target.value.replace(/\D/g, '');
                                                                            setFormData({ ...formData, contactPhone: val });
                                                                        }}
                                                                        className="w-full pl-10 p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                                    />
                                                                </div>
                                                                
                                                                {/* Secondary Phone Numbers */}
                                                                {formData.secondaryPhones?.map((phone, index) => (
                                                                    <div key={index} className="relative mt-2 animate-in fade-in slide-in-from-top-1">
                                                                        <div className="flex justify-between items-center mb-1">
                                                                            <span className="text-[10px] font-medium text-gray-500">Alternative Phone {index + 1}</span>
                                                                            <button 
                                                                                onClick={() => {
                                                                                    const newPhones = [...formData.secondaryPhones];
                                                                                    newPhones.splice(index, 1);
                                                                                    setFormData({ ...formData, secondaryPhones: newPhones });
                                                                                }}
                                                                                className="text-red-400 hover:text-red-600 transition-colors"
                                                                                title="Remove number"
                                                                            >
                                                                                <Trash2 size={12} />
                                                                            </button>
                                                                        </div>
                                                                        <div className="relative">
                                                                            <Phone className="absolute left-3 top-2 text-gray-400 h-4 w-4" />
                                                                            <input
                                                                                type="tel"
                                                                                placeholder="Alternative Phone"
                                                                                value={phone}
                                                                                onChange={e => {
                                                                                    const newPhones = [...formData.secondaryPhones];
                                                                                    newPhones[index] = e.target.value.replace(/\D/g, '');
                                                                                    setFormData({ ...formData, secondaryPhones: newPhones });
                                                                                }}
                                                                                className="w-full pl-9 p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                                <button
                                                                    onClick={() => setFormData({ ...formData, secondaryPhones: [...(formData.secondaryPhones || []), ''] })}
                                                                    className="mt-2 text-[11px] text-brand-blue font-semibold flex items-center gap-1 hover:underline active:scale-95 transition-transform"
                                                                >
                                                                    <Plus size={14} /> Add Alternative Number
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                                                            <div>
                                                                <label className="block mb-1.5 text-sm font-medium text-gray-700">Contact Value</label>
                                                                <select
                                                                    value={formData.contactValue}
                                                                    onChange={e => setFormData({ ...formData, contactValue: e.target.value })}
                                                                    className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                                >
                                                                    <option value="Standard">Standard</option>
                                                                    <option value="Mid">Mid</option>
                                                                    <option value="High">High</option>
                                                                </select>
                                                            </div>
                                                            <div>
                                                                <label className="block mb-1.5 text-sm font-medium text-gray-700">Company Name</label>
                                                                <input
                                                                    type="text"
                                                                    placeholder="Company Name"
                                                                    value={formData.companyName}
                                                                    onChange={e => setFormData({ ...formData, companyName: e.target.value })}
                                                                    className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </section>

                                                <hr className="border-gray-200" />

                                                {/* Opportunity Details Section */}
                                                <section>
                                                    <h3 className="text-lg font-bold text-gray-900 mb-4">Opportunity Details</h3>
                                                    <div className="space-y-6">
                                                        <div>
                                                            <label className="block mb-1.5 text-sm font-medium text-gray-700">Opportunity Name</label>
                                                            <input
                                                                type="text"
                                                                value={formData.name}
                                                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                                                className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                            />
                                                        </div>

                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                                                            <div>
                                                                <label className="block mb-1.5 text-sm font-medium text-gray-700">Stage</label>
                                                                <select
                                                                    value={formData.stage}
                                                                    onChange={e => {
                                                                        const newStage = e.target.value;
                                                                        let newStatus = formData.status;
                                                                        if (newStage === '10') {
                                                                            newStatus = 'Won';
                                                                        } else if (formData.stage === '10' && newStage !== '10') {
                                                                            newStatus = 'Open';
                                                                        }
                                                                        setFormData({ ...formData, stage: newStage, status: newStatus });
                                                                    }}
                                                                    className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                                >
                                                                    {stages.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
                                                                </select>
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                                                            <div>
                                                                <label className="block mb-1.5 text-sm font-medium text-gray-700">Opportunity Value</label>
                                                                <div className="relative">
                                                                    <span className="absolute left-3 top-2.5 text-gray-500 text-sm">₹</span>
                                                                    <input
                                                                        type="number"
                                                                        value={formData.value}
                                                                        onChange={e => setFormData({ ...formData, value: e.target.value })}
                                                                        className="w-full pl-8 p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div>
                                                            <label className="block mb-1.5 text-sm font-medium text-gray-700">Opportunity Source</label>
                                                            <input
                                                                type="text"
                                                                placeholder="Enter Source"
                                                                value={formData.source}
                                                                onChange={e => setFormData({ ...formData, source: e.target.value })}
                                                                className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                            />
                                                        </div>

                                                        <div>
                                                            <label className="block mb-1.5 text-sm font-medium text-gray-700">Status</label>
                                                            <select
                                                                value={formData.status}
                                                                onChange={e => setFormData({ ...formData, status: e.target.value })}
                                                                className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                            >
                                                                <option value="Open">Open</option>
                                                                <option value="Won">Won</option>
                                                                <option value="Lost">Lost</option>
                                                                <option value="Abandoned">Abandoned</option>
                                                                <option value="Not Answered">Not Answered</option>
                                                            </select>
                                                        </div>

                                                        <div>
                                                            <label className="block mb-1.5 text-sm font-medium text-gray-700">Opportunity Type</label>
                                                            <select
                                                                value={formData.opportunityType}
                                                                onChange={e => setFormData({ ...formData, opportunityType: e.target.value as any })}
                                                                className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                            >
                                                                <option value="">Select Type</option>
                                                                <option value="Real Estate">Real Estate</option>
                                                                <option value="adcalculator">Ad Calculator</option>
                                                                <option value="free audit landing page">Free Audit Landing Page</option>
                                                                <option value="Meta Ads">Meta Ads</option>
                                                                <option value="Others">Others</option>
                                                            </select>
                                                        </div>

                                                        {/* Website */}
                                                        <div>
                                                            <label className="block mb-1.5 text-sm font-medium text-gray-700">Website</label>
                                                            <input
                                                                type="text"
                                                                placeholder="Client Website"
                                                                value={formData.your_website}
                                                                onChange={e => setFormData({ ...formData, your_website: e.target.value })}
                                                                className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                            />
                                                        </div>

                                                        {/* Meta Campaign */}
                                                        <div>
                                                            <label className="block mb-1.5 text-sm font-medium text-gray-700">Meta Campaign</label>
                                                            <input
                                                                type="text"
                                                                placeholder="Campaign Name"
                                                                value={formData.meta_campaign}
                                                                onChange={e => setFormData({ ...formData, meta_campaign: e.target.value })}
                                                                className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                            />
                                                        </div>

                                                        {/* Meta Adset */}
                                                        <div>
                                                            <label className="block mb-1.5 text-sm font-medium text-gray-700">Meta Adset</label>
                                                            <input
                                                                type="text"
                                                                placeholder="Adset Name"
                                                                value={formData.meta_adset}
                                                                onChange={e => setFormData({ ...formData, meta_adset: e.target.value })}
                                                                className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                            />
                                                        </div>

                                                        <hr className="border-gray-100 my-6" />

                                                        {/* Notes Section */}
                                                        <div>
                                                            <div className="flex justify-between items-center mb-2">
                                                                <label className="block text-sm font-medium text-gray-700">Notes</label>
                                                                <button
                                                                    onClick={() => setIsAddingNote(true)}
                                                                    className="text-xs text-brand-blue font-medium hover:underline"
                                                                >
                                                                    + Add Note
                                                                </button>
                                                            </div>

                                                            {isAddingNote && (
                                                                <div className="mb-4 bg-gray-50 p-3 rounded-lg border border-gray-200">
                                                                    <textarea
                                                                        placeholder="Write a note..."
                                                                        value={newNoteContent}
                                                                        onChange={e => setNewNoteContent(e.target.value)}
                                                                        className="w-full p-2 bg-white border border-gray-300 rounded text-sm focus:ring-brand-blue focus:border-brand-blue mb-2 min-h-[80px]"
                                                                    />
                                                                    <div className="flex justify-end gap-2">
                                                                        <button onClick={() => setIsAddingNote(false)} className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 rounded">Cancel</button>
                                                                        <button onClick={handleAddNote} className="px-2 py-1 text-xs text-white bg-brand-blue rounded hover:bg-brand-blue/90">Save</button>
                                                                    </div>
                                                                </div>
                                                            )}

                                                            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                                                                {notes.length === 0 && !isAddingNote ? (
                                                                    <p className="text-sm text-gray-400 italic">No notes yet.</p>
                                                                ) : (
                                                                    [...notes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(note => (
                                                                        <div key={note.id} className="p-3 bg-gray-50 border border-gray-200 rounded-lg group">
                                                                            <p className="text-sm text-gray-800 mb-1 whitespace-pre-wrap">{note.content}</p>
                                                                            <div className="flex justify-between items-center text-xs text-gray-500">
                                                                                <span>{safeFormat(note.createdAt, 'MMM d, h:mm a')}</span>
                                                                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                    <button onClick={() => handleStartEditNote(note)} className="text-gray-400 hover:text-brand-blue" title="Edit note">
                                                                                        <Edit2 size={14} />
                                                                                    </button>
                                                                                    <button onClick={() => handleDeleteNote(note.id)} className="text-gray-400 hover:text-red-600" title="Delete note">
                                                                                        <Trash2 size={14} />
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    ))
                                                                )}
                                                            </div>
                                                        </div>

                                                        <hr className="border-gray-100 my-6" />

                                                        {/* Follow up Section */}
                                                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mt-4">
                                                        <div className="flex items-center gap-2 mb-4 border-b border-gray-200 pb-2">
                                                            <div className="p-1.5 bg-brand-blue/10 rounded-md text-brand-blue">
                                                                <User size={16} />
                                                            </div>
                                                            <h3 className="text-sm font-bold text-gray-900">Follow-up Management</h3>
                                                            <div className="ml-auto text-[10px] font-medium text-gray-500 bg-white px-2 py-1 rounded border border-gray-200">
                                                                Current User: <span className="text-brand-blue font-bold">{currentUser?.name}</span>
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                            <div>
                                                                <label className="block mb-2 text-sm font-medium text-gray-700">Follow up Date {(!isYetToContactUI && !isJunkOrNoBudgetUI) && <span className="text-red-500">*</span>}</label>
                                                                <div className="relative">
                                                                    <Calendar size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                                                    <input
                                                                        type="date"
                                                                        placeholder="dd/mm/yyyy"
                                                                        value={formData.followUpDate}
                                                                        onChange={e => setFormData({ ...formData, followUpDate: e.target.value })}
                                                                        onClick={(e) => (e.target as any).showPicker?.()}
                                                                        className="w-full pl-10 p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue cursor-pointer"
                                                                    />
                                                                </div>
                                                            </div>

                                                            <div>
                                                                <label className="block mb-2 text-sm font-medium text-gray-700">Follow up Assignee {(!isYetToContactUI && !isJunkOrNoBudgetUI) && <span className="text-red-500">*</span>}</label>
                                                                <select
                                                                    value={formData.followUpAssignee}
                                                                    onChange={e => setFormData({ ...formData, followUpAssignee: e.target.value })}
                                                                    className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                                >
                                                                    <option value="">Select Assignee</option>
                                                                    {TEAM_MEMBERS.map(member => (
                                                                        <option key={member.email} value={member.email}>{member.name}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    </div>
                                                </section>
                                            </>
                                        )}

                                        {/* VOICE AGENT TAB */}
                                        {activeTab === 'voice-agent' && (
                                            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                                                <div className="flex justify-between items-center">
                                                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                                        Voice Agent Input <Sparkles size={18} className="text-brand-blue" />
                                                    </h3>
                                                </div>

                                                {(() => {
                                                    const currentOpp = opportunities.find(o => o.id === editingId);
                                                    if (!currentOpp) return null;

                                                    return (
                                                        <div className="space-y-6">
                                                            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 grid grid-cols-1 md:grid-cols-3 gap-4">
                                                                <div>
                                                                    <div className="text-xs text-gray-500 mb-1">Status</div>
                                                                    <div className="font-bold text-gray-900 flex items-center gap-2">
                                                                        {currentOpp.aiCallStatus || 'Not Initiated'}
                                                                        {currentOpp.isAIPending && <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-[10px] rounded uppercase">Pending</span>}
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <div className="text-xs text-gray-500 mb-1">Duration</div>
                                                                    <div className="font-bold text-gray-900">
                                                                        {currentOpp.aiCallDuration ? `${Math.floor(currentOpp.aiCallDuration / 60)}m ${currentOpp.aiCallDuration % 60}s` : '-'}
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <div className="text-xs text-gray-500 mb-1">Call ID</div>
                                                                    <div className="text-sm text-gray-900 font-mono truncate" title={currentOpp.aiCallId || ''}>
                                                                        {currentOpp.aiCallId || '-'}
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {currentOpp.aiSummary && (
                                                                <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl">
                                                                    <h4 className="font-bold text-blue-900 flex items-center gap-2 mb-2">
                                                                        <Target size={16} /> Call Summary
                                                                    </h4>
                                                                    <p className="text-sm text-blue-800 leading-relaxed">
                                                                        {currentOpp.aiSummary}
                                                                    </p>
                                                                </div>
                                                            )}

                                                            {currentOpp.aiSuggestions && currentOpp.aiSuggestions.length > 0 && (
                                                                <div className="bg-purple-50 border border-purple-100 p-4 rounded-xl">
                                                                    <h4 className="font-bold text-purple-900 flex items-center gap-2 mb-3">
                                                                        <Sparkles size={16} /> AI Suggestions for Sales Agent
                                                                    </h4>
                                                                    <ul className="space-y-2">
                                                                        {currentOpp.aiSuggestions.map((suggestion: string, idx: number) => (
                                                                            <li key={idx} className="flex gap-2 text-sm text-purple-800">
                                                                                <span className="text-purple-400 mt-0.5">•</span>
                                                                                <span>{suggestion}</span>
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                </div>
                                                            )}

                                                            {currentOpp.aiTranscript && (
                                                                <div className="bg-white border border-gray-200 p-4 rounded-xl shadow-sm">
                                                                    <h4 className="font-bold text-gray-900 flex items-center gap-2 mb-3">
                                                                        <MessageSquare size={16} className="text-gray-400" /> Full Transcript
                                                                    </h4>
                                                                    <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto whitespace-pre-wrap text-sm text-gray-700 font-mono custom-scrollbar">
                                                                        {currentOpp.aiTranscript}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {!currentOpp.aiCallId && (
                                                                <div className="text-center py-10 bg-gray-50 rounded-xl border border-gray-200 border-dashed">
                                                                    <PhoneOutgoing size={32} className="mx-auto text-gray-300 mb-3" />
                                                                    <h4 className="font-bold text-gray-700">No AI Call Found</h4>
                                                                    <p className="text-sm text-gray-500 max-w-sm mx-auto mt-1">
                                                                        This lead has not been processed by the Huskyvoice AI qualification agent.
                                                                    </p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        )}

                                        {/* ACTIVITY TAB (Leads Movement) */}
                                        {activeTab === 'discovery' && (
                                            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                                                <div className="flex justify-between items-center">
                                                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                                        Discovery Form Responses <Search size={18} className="text-gray-400" />
                                                    </h3>
                                                    <button 
                                                        onClick={() => fetchDiscoveryResponses(formData.contactPhone)}
                                                        className="text-xs text-brand-blue hover:bg-blue-50 px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-bold transition-all"
                                                    >
                                                        <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
                                                        Refresh
                                                    </button>
                                                </div>

                                                {discoveryResponses.length === 0 ? (
                                                    <div className="text-center py-24 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
                                                        <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-6">
                                                            <Search className="w-8 h-8 text-gray-300" />
                                                        </div>
                                                        <p className="text-gray-600 font-bold text-lg">No responses found</p>
                                                        <p className="text-sm text-gray-400 mt-2 max-w-xs mx-auto">We couldn't find any discovery form submissions for {formData.contactPhone || 'this number'}.</p>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-8">
                                                        {discoveryResponses.map((response, idx) => (
                                                            <div key={response.id} className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-xl shadow-gray-100/50 hover:shadow-2xl hover:shadow-gray-200/50 transition-all duration-300 border-l-4 border-l-brand-blue">
                                                                <div className="bg-gradient-to-r from-gray-50 to-white px-8 py-5 border-b border-gray-100 flex justify-between items-center">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="w-8 h-8 bg-brand-blue/10 rounded-lg flex items-center justify-center text-brand-blue font-bold text-xs">
                                                                            {discoveryResponses.length - idx}
                                                                        </div>
                                                                        <span className="text-sm font-bold text-gray-900">Form Submission</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2 text-gray-400">
                                                                        <Clock size={14} />
                                                                        <span className="text-xs font-medium">{safeFormat(response.submittedAt, 'MMM d, yyyy • h:mm a')}</span>
                                                                    </div>
                                                                </div>

                                                                {/* AI ANALYSIS SECTION */}
                                                                <div className="px-8 pt-6">
                                                                    {!response.aiAnalysis ? (
                                                                        <button 
                                                                            onClick={() => handleAnalyzeDiscovery(response)}
                                                                            disabled={isAnalyzingDiscovery[response.id]}
                                                                            className="w-full py-4 bg-gradient-to-r from-brand-blue/5 to-indigo-500/10 border-2 border-dashed border-brand-blue/20 rounded-2xl flex flex-col items-center justify-center gap-2 hover:border-brand-blue/40 hover:from-brand-blue/10 hover:to-indigo-500/20 transition-all group"
                                                                        >
                                                                            {isAnalyzingDiscovery[response.id] ? (
                                                                                <>
                                                                                    <RefreshCw size={24} className="text-brand-blue animate-spin" />
                                                                                    <span className="text-sm font-bold text-brand-blue">Gemini is thinking...</span>
                                                                                </>
                                                                            ) : (
                                                                                <>
                                                                                    <Sparkles size={24} className="text-brand-blue group-hover:scale-110 transition-transform" />
                                                                                    <span className="text-sm font-bold text-gray-700">Generate AI Sales Strategy</span>
                                                                                </>
                                                                            )}
                                                                        </button>
                                                                    ) : (
                                                                        <div className="bg-gradient-to-br from-indigo-50/50 via-white to-brand-blue/5 rounded-3xl border border-indigo-100/50 p-6 shadow-sm overflow-hidden relative">
                                                                            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                                                                                <Sparkles size={120} />
                                                                            </div>
                                                                            <div className="flex items-center gap-2 mb-4 text-indigo-600">
                                                                                <Sparkles size={18} />
                                                                                <h4 className="font-black text-xs uppercase tracking-widest">AI Intelligence Report</h4>
                                                                            </div>
                                                                            
                                                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                                                                <div className="space-y-4">
                                                                                    <div>
                                                                                        <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1 block">Strategic Approach</label>
                                                                                        <p className="text-sm text-gray-800 font-bold leading-relaxed">{response.aiAnalysis.strategy}</p>
                                                                                    </div>
                                                                                    <div>
                                                                                        <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1 block">Opening Script</label>
                                                                                        <div className="bg-white/60 border border-indigo-100 rounded-xl p-3 text-sm text-indigo-900 italic font-medium">
                                                                                            "{response.aiAnalysis.openingScript}"
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                                
                                                                                <div className="space-y-4">
                                                                                    <div>
                                                                                        <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1 block">Key Talking Points</label>
                                                                                        <div className="flex flex-wrap gap-2">
                                                                                            {response.aiAnalysis.talkingPoints.map((point: string, i: number) => (
                                                                                                <span key={i} className="px-3 py-1 bg-white border border-indigo-50 text-indigo-700 text-xs font-bold rounded-lg shadow-sm">
                                                                                                    {point}
                                                                                                </span>
                                                                                            ))}
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="grid grid-cols-2 gap-4">
                                                                                        <div>
                                                                                            <label className="text-[10px] font-black text-green-500 uppercase tracking-widest mb-1 block">Hot Buttons</label>
                                                                                            <ul className="text-[11px] font-bold text-gray-600 list-disc list-inside">
                                                                                                {response.aiAnalysis.hotButtons.map((btn: string, i: number) => <li key={i}>{btn}</li>)}
                                                                                            </ul>
                                                                                        </div>
                                                                                        <div>
                                                                                            <label className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1 block">Concerns</label>
                                                                                            <ul className="text-[11px] font-bold text-gray-600 list-disc list-inside">
                                                                                                {response.aiAnalysis.concerns.map((con: string, i: number) => <li key={i}>{con}</li>)}
                                                                                            </ul>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>

                                                                <div className="p-8 pt-4">
                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-8">
                                                                        {Object.entries(response.responses).map(([question, answer]) => (
                                                                            <div key={question} className="space-y-2 group">
                                                                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest group-hover:text-brand-blue transition-colors">{question}</label>
                                                                                <p className="text-sm text-gray-800 font-semibold leading-relaxed bg-gray-50/50 p-3 rounded-xl border border-transparent group-hover:border-blue-100 transition-all">{answer || '-'}</p>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {activeTab === 'activity' && (
                                            <section>
                                                <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                                                    Leads Movement <Clock size={18} className="text-gray-400" />
                                                </h3>
                                                <div className="relative border-l-2 border-gray-100 ml-3 pl-8 space-y-8">
                                                    {(() => {
                                                        const currentOpp = opportunities.find(o => o.id === editingId);
                                                        const activities = currentOpp?.activities || [];
                                                        
                                                        if (activities.length === 0) {
                                                            return <p className="text-sm text-gray-500 italic">No activity recorded yet.</p>;
                                                        }

                                                        return activities.map((activity, idx) => (
                                                            <div key={activity.id} className="relative">
                                                                {/* Timeline Dot */}
                                                                <div className="absolute -left-[41px] top-1 w-4 h-4 rounded-full border-2 border-white bg-brand-blue shadow-sm z-10" />
                                                                
                                                                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                                                                    <div className="flex justify-between items-start mb-2">
                                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                                                            activity.type === 'stage_change' ? 'bg-purple-100 text-purple-700' :
                                                                            activity.type === 'status_change' ? 'bg-green-100 text-green-700' :
                                                                            activity.type === 'note_added' ? 'bg-orange-100 text-orange-700' :
                                                                            activity.type === 'task_added' ? 'bg-blue-100 text-blue-700' :
                                                                            'bg-gray-200 text-gray-700'
                                                                        }`}>
                                                                            {activity.type.replace('_', ' ')}
                                                                        </span>
                                                                        <span className="text-[10px] text-gray-500 font-medium">
                                                                            {safeFormat(activity.timestamp, 'MMM d, yyyy • h:mm a')}
                                                                        </span>
                                                                    </div>
                                                                    <p className="text-sm text-gray-800 font-medium">{activity.description}</p>
                                                                    <div className="mt-3 flex items-center gap-2">
                                                                        <div className="w-5 h-5 rounded-full bg-brand-blue/10 flex items-center justify-center text-[10px] font-bold text-brand-blue">
                                                                            {activity.userName?.charAt(0) || 'U'}
                                                                        </div>
                                                                        <span className="text-xs text-gray-500">By {activity.userName}</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ));
                                                    })()}
                                                </div>
                                            </section>
                                        )}

                                        {/* APPOINTMENT TAB */}
                                        {activeTab === 'book-update-appointment' && (
                                            <section>
                                                <h3 className="text-lg font-bold text-gray-900 mb-6">Book/Update Appointment</h3>
                                                <div className="space-y-6">
                                                    <div>
                                                        <label className="block mb-1.5 text-sm font-medium text-gray-700">Calendar <span className="text-red-500">*</span></label>
                                                        <select
                                                            value={appointmentForm.calendar}
                                                            onChange={e => setAppointmentForm({ ...appointmentForm, calendar: e.target.value })}
                                                            className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                        >
                                                            <option value="">Select calendar</option>
                                                            <option value="default">Default Calendar</option>
                                                        </select>
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-6">
                                                        <div>
                                                            <label className="block mb-1.5 text-sm font-medium text-gray-700">Date <span className="text-red-500">*</span></label>
                                                            <input
                                                                type="date"
                                                                value={appointmentForm.date}
                                                                onChange={e => setAppointmentForm({ ...appointmentForm, date: e.target.value })}
                                                                onClick={(e) => (e.target as any).showPicker?.()}
                                                                className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue cursor-pointer"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block mb-1.5 text-sm font-medium text-gray-700">Time <span className="text-red-500">*</span></label>
                                                            <div className="flex items-center bg-white border border-gray-300 rounded-lg px-2 py-1 gap-1">
                                                                <select
                                                                    value={getTimeParts(appointmentForm.time).hour12}
                                                                    onChange={e => setAppointmentForm({ ...appointmentForm, time: joinTimeParts(parseInt(e.target.value), getTimeParts(appointmentForm.time).minutes, getTimeParts(appointmentForm.time).ampm) })}
                                                                    className="bg-transparent border-none p-1 text-sm focus:ring-0 outline-none w-14"
                                                                >
                                                                    {[...Array(12)].map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                                                                </select>
                                                                <span className="text-gray-400">:</span>
                                                                <select
                                                                    value={getTimeParts(appointmentForm.time).minutes}
                                                                    onChange={e => setAppointmentForm({ ...appointmentForm, time: joinTimeParts(getTimeParts(appointmentForm.time).hour12, e.target.value, getTimeParts(appointmentForm.time).ampm) })}
                                                                    className="bg-transparent border-none p-1 text-sm focus:ring-0 outline-none w-14"
                                                                >
                                                                    {['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].map(m => (
                                                                        <option key={m} value={m}>{m}</option>
                                                                    ))}
                                                                </select>
                                                                <select
                                                                    value={getTimeParts(appointmentForm.time).ampm}
                                                                    onChange={e => setAppointmentForm({ ...appointmentForm, time: joinTimeParts(getTimeParts(appointmentForm.time).hour12, getTimeParts(appointmentForm.time).minutes, e.target.value) })}
                                                                    className="bg-transparent border-none p-1 text-sm font-bold text-brand-blue focus:ring-0 outline-none"
                                                                >
                                                                    <option value="AM">AM</option>
                                                                    <option value="PM">PM</option>
                                                                </select>
                                                                <Clock size={16} className="text-gray-400 ml-auto" />
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-6">
                                                        <div>
                                                            <label className="block mb-1.5 text-sm font-medium text-gray-700">Meeting Location</label>
                                                            <input
                                                                type="text"
                                                                placeholder="Meeting Location"
                                                                value={appointmentForm.location}
                                                                onChange={e => setAppointmentForm({ ...appointmentForm, location: e.target.value })}
                                                                className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block mb-1.5 text-sm font-medium text-gray-700">Appointment Title</label>
                                                            <input
                                                                type="text"
                                                                placeholder="Appointment Title"
                                                                value={appointmentForm.title}
                                                                onChange={e => setAppointmentForm({ ...appointmentForm, title: e.target.value })}
                                                                className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                            />
                                                        </div>
                                                    </div>

                                                    <div className="flex justify-end pt-4">
                                                        <button
                                                            onClick={handleBookAppointment}
                                                            className="px-5 py-2.5 text-sm font-medium text-white bg-brand-blue rounded-lg hover:bg-brand-blue/90 focus:ring-4 focus:ring-brand-blue/30"
                                                        >
                                                            Book Appointment
                                                        </button>
                                                    </div>
                                                </div>
                                            </section>
                                        )}

                                        {/* TASKS TAB */}
                                        {activeTab === 'notes' && (
                                            <section className="h-full flex flex-col">
                                                <div className="flex justify-between items-center mb-6">
                                                    <h3 className="text-lg font-bold text-gray-900">Notes</h3>
                                                    <div className="flex gap-2">
                                                        <button className="p-2 text-gray-400 hover:text-gray-600"><Filter size={18} /></button>
                                                    </div>
                                                </div>

                                                <div className="mb-6">
                                                    <button
                                                        onClick={() => setIsAddingNote(true)}
                                                        className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-brand-blue font-medium hover:bg-blue-50 hover:border-brand-blue transition-colors flex items-center justify-center gap-2"
                                                    >
                                                        <Plus size={18} /> Add Note
                                                    </button>
                                                </div>

                                                {isAddingNote && (
                                                    <div className="mb-6 bg-gray-50 p-4 rounded-lg border border-gray-200 animate-in fade-in slide-in-from-top-2">
                                                        <textarea
                                                            placeholder="Write a note..."
                                                            value={newNoteContent}
                                                            onChange={e => setNewNoteContent(e.target.value)}
                                                            className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue mb-3 min-h-[100px]"
                                                            autoFocus
                                                        />
                                                        <div className="flex justify-end gap-2">
                                                            <button onClick={() => {
                                                                setIsAddingNote(false);
                                                                setEditingNoteId(null);
                                                                setNewNoteContent('');
                                                            }} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 rounded">Cancel</button>
                                                            <button onClick={handleAddNote} className="px-3 py-1.5 text-sm text-white bg-brand-blue rounded hover:bg-brand-blue/90">
                                                                {editingNoteId ? 'Update Note' : 'Add Note'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="relative mb-6">
                                                    <Search className="absolute left-3 top-2.5 text-gray-400 h-5 w-5" />
                                                    <input
                                                        type="text"
                                                        placeholder="Search"
                                                        className="w-full pl-10 p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                    />
                                                </div>

                                                <div className="flex-1 overflow-y-auto">
                                                    {notes.length === 0 ? (
                                                        <div className="flex flex-col items-center justify-center h-64 text-center">
                                                            <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4 text-brand-blue">
                                                                <MessageSquare size={32} />
                                                            </div>
                                                            <h4 className="text-gray-900 font-medium mb-1">No notes found</h4>
                                                            <p className="text-gray-500 text-sm mb-4">Your filters does not match any notes. Please try again.</p>
                                                            <button onClick={() => setIsAddingNote(true)} className="px-4 py-2 bg-brand-blue text-white rounded-lg text-sm font-medium hover:bg-brand-blue/90">
                                                                + Add Note
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-4">
                                                            {[...notes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(note => (
                                                                <div key={note.id} className="p-4 bg-white border border-gray-200 rounded-lg hover:shadow-sm">
                                                                    <p className="text-sm text-gray-800 mb-2 whitespace-pre-wrap">{note.content}</p>
                                                                    <div className="flex justify-between items-center text-xs text-gray-500">
                                                                        <div className="flex items-center gap-1">
                                                                            <Clock size={12} />
                                                                            <span>{safeFormat(note.createdAt, 'MMM d, yyyy h:mm a')}</span>
                                                                        </div>
                                                                        <div className="flex items-center gap-3">
                                                                            <button onClick={() => handleStartEditNote(note)} className="text-gray-400 hover:text-brand-blue" title="Edit note">
                                                                                <Edit2 size={18} />
                                                                            </button>
                                                                            <button onClick={() => handleDeleteNote(note.id)} className="text-gray-400 hover:text-red-600" title="Delete note">
                                                                                <Trash2 size={18} />
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </section>
                                        )}

                                        {activeTab === 'calls' && (
                                            <section className="h-full flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
                                                {(() => {
                                                    const currentOpp = opportunities.find(o => o.id === editingId);
                                                    return (
                                                        <>
                                                            <div className="flex items-center justify-between mb-6">
                                                                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                                                    Call History <Phone size={18} className="text-brand-blue" />
                                                                </h3>
                                                                <div className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full border border-gray-200 flex items-center gap-1.5">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                                                                    Syncing with Salestrail
                                                                </div>
                                                            </div>

                                                            <div className="flex-1 overflow-y-auto min-h-[400px]">
                                                                {(!currentOpp?.calls || currentOpp.calls.length === 0) ? (
                                                                    <div className="flex flex-col items-center justify-center h-64 text-center bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 mx-1">
                                                                        <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4 text-brand-blue/40">
                                                                            <Phone size={32} />
                                                                        </div>
                                                                        <h4 className="text-gray-900 font-bold mb-1">No calls recorded</h4>
                                                                        <p className="text-gray-500 text-sm max-w-xs">Outgoing and incoming calls to {formData.contactPhone} will appear here automatically.</p>
                                                                    </div>
                                                                ) : (
                                                                    <div className="space-y-3">
                                                                        {[...currentOpp.calls].sort((a,b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()).map((call, idx) => (
                                                                            <div key={call.id || idx} className="p-4 bg-white border border-gray-200 rounded-xl hover:shadow-md transition-all group">
                                                                                <div className="flex flex-col gap-3">
                                                                                    <div className="flex justify-between items-start">
                                                                                        <div className="flex gap-4">
                                                                                            <div className={`p-2.5 rounded-lg shrink-0 ${String(call.type).toUpperCase() === 'INCOMING' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                                                                                                {String(call.type).toUpperCase() === 'INCOMING' ? <PhoneIncoming size={20} /> : <PhoneOutgoing size={20} />}
                                                                                            </div>
                                                                                            <div>
                                                                                                <div className="flex items-center gap-2 mb-1">
                                                                                                    <span className="text-sm font-bold text-gray-900">{call.userName}</span>
                                                                                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                                                                                        (call.status === 'Completed' || (call.answered && !call.status)) ? 'bg-green-100 text-green-700' : 
                                                                                                        (call.status === 'Missed Call') ? 'bg-red-100 text-red-700' :
                                                                                                        (call.status === 'Not Answered') ? 'bg-orange-100 text-orange-700' :
                                                                                                        'bg-red-100 text-red-700'
                                                                                                    }`}>
                                                                                                        {call.status || (call.answered ? 'Answered' : 'Missed')}
                                                                                                    </span>
                                                                                                </div>
                                                                                                <div className="flex items-center gap-3 text-xs text-gray-500">
                                                                                                    <span className="flex items-center gap-1">
                                                                                                        <Clock size={12} />
                                                                                                        {safeFormat(call.startTime, 'MMM d, h:mm a')}
                                                                                                    </span>
                                                                                                    <span className="flex items-center gap-1">
                                                                                                        <Timer size={12} />
                                                                                                        {Math.floor(call.duration / 60)}m {call.duration % 60}s
                                                                                                    </span>
                                                                                                </div>
                                                                                            </div>
                                                                                        </div>
                                                                                    </div>
                                                                                                                                                    {call.recordingUrl && (
                                                                                        <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200 flex items-center gap-3">
                                                                                            <div className="w-8 h-8 rounded-full bg-brand-blue/10 flex items-center justify-center text-brand-blue">
                                                                                                <Volume2 size={16} />
                                                                                            </div>
                                                                                            <div className="flex-1">
                                                                                                <audio 
                                                                                                    controls 
                                                                                                    src={`https://us-central1-crm1-76cc4.cloudfunctions.net/getRecordingAudio?url=${encodeURIComponent(call.recordingUrl)}`} 
                                                                                                    className="w-full h-8 accent-brand-blue"
                                                                                                />
                                                                                            </div>
                                                                                        </div>
                                                                                    )}

                                                                                    {call.aiAnalysis && (
                                                                                        <div className="mt-3 p-4 bg-gradient-to-br from-blue-50/50 to-indigo-50/50 rounded-xl border border-blue-100 shadow-sm overflow-hidden relative group/ai">
                                                                                            <div className="absolute top-0 right-0 p-2 opacity-10 group-hover/ai:opacity-20 transition-opacity">
                                                                                                <TrendingUp size={64} className="text-brand-blue" />
                                                                                            </div>
                                                                                            
                                                                                            <div className="flex items-center justify-between mb-3">
                                                                                                <div className="flex items-center gap-2">
                                                                                                    <div className="p-1.5 bg-brand-blue text-white rounded-lg shadow-sm">
                                                                                                        <Zap size={14} />
                                                                                                    </div>
                                                                                                    <span className="text-xs font-bold text-brand-blue uppercase tracking-wider">AI Call Insight</span>
                                                                                                </div>
                                                                                                <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-white font-bold text-sm shadow-sm ${
                                                                                                    call.aiAnalysis.rating >= 8 ? 'bg-green-500' :
                                                                                                    call.aiAnalysis.rating >= 5 ? 'bg-orange-500' :
                                                                                                    'bg-red-500'
                                                                                                }`}>
                                                                                                    <Award size={14} />
                                                                                                    {call.aiAnalysis.rating}/10
                                                                                                </div>
                                                                                            </div>

                                                                                            <div className="relative z-10 space-y-3">
                                                                                                <div>
                                                                                                    <p className="text-sm font-medium text-gray-800 leading-relaxed italic">
                                                                                                        "{call.aiAnalysis.summary}"
                                                                                                    </p>
                                                                                                </div>

                                                                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                                                    <div className="p-3 bg-white/60 rounded-lg border border-green-100">
                                                                                                        <h5 className="text-[10px] font-bold text-green-700 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                                                                                                            <CheckSquare size={12} /> Key Strengths
                                                                                                        </h5>
                                                                                                        <ul className="space-y-1">
                                                                                                            {(call.aiAnalysis.goodFeatures || []).slice(0, 3).map((item, idx) => (
                                                                                                                <li key={idx} className="text-xs text-gray-700 flex items-start gap-1.5">
                                                                                                                    <div className="w-1 h-1 rounded-full bg-green-500 mt-1.5 shrink-0"></div>
                                                                                                                    {item}
                                                                                                                </li>
                                                                                                            ))}
                                                                                                        </ul>
                                                                                                    </div>
                                                                                                    <div className="p-3 bg-white/60 rounded-lg border border-orange-100">
                                                                                                        <h5 className="text-[10px] font-bold text-orange-700 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                                                                                                            <TrendingUp size={12} /> Improvements
                                                                                                        </h5>
                                                                                                        <ul className="space-y-1">
                                                                                                            {(call.aiAnalysis.improvements || []).slice(0, 3).map((item, idx) => (
                                                                                                                <li key={idx} className="text-xs text-gray-700 flex items-start gap-1.5">
                                                                                                                    <div className="w-1 h-1 rounded-full bg-orange-500 mt-1.5 shrink-0"></div>
                                                                                                                    {item}
                                                                                                                </li>
                                                                                                            ))}
                                                                                                        </ul>
                                                                                                    </div>
                                                                                                </div>
                                                                                            </div>
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </>
                                                    );
                                                })()}
                                            </section>
                                        )}
                                    </div>
                                    </div>
                                    {/* RIGHT PANEL: TASKS */}
                                    <div className="w-full lg:w-[450px] bg-gray-50 flex flex-col overflow-y-auto p-6 shrink-0 border-t lg:border-t-0 border-gray-200">
                                        <section className="h-full flex flex-col">

                                                {!isAddingTask ? (
                                                    <>
                                                        <div className="flex justify-between items-center mb-6">
                                                            <h3 className="text-lg font-bold text-gray-900">Tasks</h3>
                                                            <div className="flex gap-2">
                                                                <button className="p-2 text-gray-400 hover:text-gray-600"><Filter size={18} /></button>
                                                            </div>
                                                        </div>

                                                        <div className="mb-6">
                                                            <button
                                                                onClick={() => {
                                                                    setNewTaskTitle('');
                                                                    setNewTaskAssignee(formData.followUpAssignee || formData.owner || currentUser?.email || '');
                                                                    setIsAddingTask(true);
                                                                }}
                                                                className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-brand-blue font-medium hover:bg-blue-50 hover:border-brand-blue transition-colors flex items-center justify-center gap-2"
                                                            >
                                                                <Plus size={18} /> Add Task
                                                            </button>
                                                        </div>

                                                        <div className="relative mb-6">
                                                            <Search className="absolute left-3 top-2.5 text-gray-400 h-5 w-5" />
                                                            <input
                                                                type="text"
                                                                placeholder="Search by task title"
                                                                className="w-full pl-10 p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                            />
                                                        </div>

                                                        <div className="flex-1 overflow-y-auto">
                                                            {tasks.length === 0 ? (
                                                                <div className="flex flex-col items-center justify-center h-64 text-center">
                                                                    <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4 text-brand-blue">
                                                                        <CheckSquare size={32} />
                                                                    </div>
                                                                    <h4 className="text-gray-900 font-medium mb-1">No tasks found</h4>
                                                                    <p className="text-gray-500 text-sm mb-4">There are no tasks available</p>
                                                                    <button onClick={() => {
                                                                        setNewTaskTitle('');
                                                                        setNewTaskAssignee(formData.followUpAssignee || formData.owner || currentUser?.email || '');
                                                                        setIsAddingTask(true);
                                                                    }} className="px-4 py-2 bg-brand-blue text-white rounded-lg text-sm font-medium hover:bg-brand-blue/90">
                                                                        + Add New Task
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <div className="space-y-6">
                                                                    {tasks.filter(t => !t.isCompleted).length > 0 && (
                                                                        <div className="space-y-3">
                                                                            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2 border-b pb-2">
                                                                                <span className="w-2 h-2 rounded-full bg-brand-blue"></span> Active Tasks
                                                                            </h4>
                                                                            {tasks.filter(t => !t.isCompleted).map(task => {
                                                                                const canComplete = canToggleTaskCompletion(task, currentUser?.id, currentUser?.email);
                                                                                const canEdit = canEditTask(task, currentUser?.id, currentUser?.email);
                                                                                const canDelete = canDeleteTask(task, currentUser?.id, currentUser?.email);

                                                                                return (
                                                                                    <div key={task.id} className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg hover:shadow-sm">
                                                                                        <div className="flex items-center gap-3">
                                                                                            {canComplete ? (
                                                                                                <input type="checkbox" checked={task.isCompleted} onChange={() => handleToggleTaskCompletion(task.id)} className="h-4 w-4 text-brand-blue rounded border-gray-300 focus:ring-brand-blue cursor-pointer" />
                                                                                            ) : (
                                                                                                <div className="h-4 w-4 rounded border-2 border-gray-300 bg-gray-50 opacity-50" title="Only assigned user can complete this task"></div>
                                                                                            )}
                                                                                            <div className="flex flex-col">
                                                                                                <span className="text-sm font-medium text-gray-900">{task.title}</span>
                                                                                                {task.description && (
                                                                                                    <span className="text-xs text-gray-500 line-clamp-1 max-w-[200px] mt-0.5">{task.description}</span>
                                                                                                )}
                                                                                                <div className="flex flex-wrap gap-2 items-center mt-1">
                                                                                                    {task.dueDate && (
                                                                                                        <span className="text-[10px] text-gray-400">Due: {task.dueDate} {formatTimeToAMPM(task.dueTime || '')}</span>
                                                                                                    )}
                                                                                                    {task.assignee && (
                                                                                                        <span className="text-[10px] text-blue-500 font-medium bg-blue-50 px-1 rounded">
                                                                                                            {task.assignee === currentUser?.email || task.assignee === currentUser?.id ? (
                                                                                                                task.assignedBy === currentUser?.email || task.assignedBy === currentUser?.id ? 'Self Assigned' : `Assigned by ${task.assignedBy?.split('@')[0] || 'Unknown'}`
                                                                                                            ) : (
                                                                                                                `Assigned to: ${task.assignee.includes('@') ? task.assignee.split('@')[0] : task.assignee}`
                                                                                                            )}
                                                                                                        </span>
                                                                                                    )}
                                                                                                    {formData.contactPhone && (
                                                                                                        <span className="text-[10px] text-green-600 font-medium bg-green-50 px-1 rounded flex items-center gap-0.5">
                                                                                                            <Phone size={8} /> {formData.contactPhone}
                                                                                                        </span>
                                                                                                    )}
                                                                                                </div>
                                                                                            </div>
                                                                                        </div>
                                                                                        <div className="flex items-center gap-2">
                                                                                            {canEdit && (
                                                                                                <button onClick={() => handleStartEditTask(task)} className="text-gray-400 hover:text-brand-blue" title="Edit task">
                                                                                                    <Edit2 size={16} />
                                                                                                </button>
                                                                                            )}
                                                                                            {canDelete && (
                                                                                                <button onClick={() => handleDeleteTask(task.id)} className="text-gray-400 hover:text-red-600" title="Delete task">
                                                                                                    <Trash2 size={16} />
                                                                                                </button>
                                                                                            )}
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    )}

                                                                    {tasks.filter(t => t.isCompleted).length > 0 && (
                                                                        <div className="space-y-3">
                                                                            <h4 className="text-sm font-semibold text-gray-500 flex items-center gap-2 border-b pb-2">
                                                                                <CheckSquare size={14} /> Completed Tasks
                                                                            </h4>
                                                                            {tasks.filter(t => t.isCompleted).map(task => {
                                                                                const canComplete = canToggleTaskCompletion(task, currentUser?.id, currentUser?.email);
                                                                                const canDelete = canDeleteTask(task, currentUser?.id, currentUser?.email);

                                                                                return (
                                                                                    <div key={task.id} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg hover:shadow-sm opacity-80">
                                                                                        <div className="flex items-center gap-3">
                                                                                            {canComplete ? (
                                                                                                <input type="checkbox" checked={task.isCompleted} onChange={() => handleToggleTaskCompletion(task.id)} className="h-4 w-4 text-brand-blue rounded border-gray-300 focus:ring-brand-blue cursor-pointer" />
                                                                                            ) : (
                                                                                                <div className="h-4 w-4 rounded border-2 border-gray-300 bg-gray-100 opacity-50" title="Only assigned user can un-complete this task"></div>
                                                                                            )}
                                                                                            <div className="flex flex-col">
                                                                                                <span className="text-sm font-medium text-gray-400 line-through">{task.title}</span>
                                                                                                <div className="flex gap-2 items-center mt-1">
                                                                                                    {task.completedAt ? (
                                                                                                        <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded flex items-center gap-1 font-medium">
                                                                                                            <CheckSquare size={10} /> 
                                                                                                            Completed on {format(new Date(task.completedAt), 'MMM d, h:mm a')}
                                                                                                            {task.completedBy && ` by ${task.completedBy.split('@')[0]}`}
                                                                                                        </span>
                                                                                                    ) : (
                                                                                                        <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded flex items-center gap-1 font-medium">
                                                                                                            <CheckSquare size={10} /> Completed
                                                                                                        </span>
                                                                                                    )}
                                                                                                </div>
                                                                                            </div>
                                                                                        </div>
                                                                                        <div className="flex items-center gap-2">
                                                                                            {canDelete && (
                                                                                                <button onClick={() => handleDeleteTask(task.id)} className="text-gray-400 hover:text-red-600" title="Delete task">
                                                                                                    <Trash2 size={16} />
                                                                                                </button>
                                                                                            )}
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className="animate-in fade-in slide-in-from-right-4 h-full flex flex-col">
                                                        <div className="flex items-center gap-2 mb-6">
                                                            <button onClick={() => {
                                                                setIsAddingTask(false);
                                                                setEditingTaskId(null);
                                                                setNewTaskTitle('');
                                                                setNewTaskDescription('');
                                                            }} className="text-gray-500 hover:text-gray-700">
                                                                <ChevronDown className="rotate-90" size={20} />
                                                            </button>
                                                            <div className="flex items-center gap-3">
                                                                <h3 className="text-lg font-bold text-gray-900">{editingTaskId ? 'Edit Task' : 'Add Task'}</h3>
                                                                {formData.contactPhone && (
                                                                    <div className="flex items-center gap-1.5 px-2 py-1 bg-green-50 text-green-700 rounded-md text-xs font-semibold">
                                                                        <Phone size={12} />
                                                                        {formData.contactPhone}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="space-y-6 flex-1 overflow-y-auto pr-2">
                                                            <div>
                                                                <label className="block mb-1.5 text-sm font-medium text-gray-700">Title <span className="text-red-500">*</span></label>
                                                                <input
                                                                    type="text"
                                                                    placeholder="Task title"
                                                                    value={newTaskTitle}
                                                                    onChange={e => setNewTaskTitle(e.target.value)}
                                                                    className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                                />
                                                            </div>

                                                            <div>
                                                                <button
                                                                    className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2"
                                                                    onClick={() => setNewTaskDescription('')}
                                                                >
                                                                    <div className="w-4 h-4 rounded-full border border-gray-400 flex items-center justify-center">
                                                                        <div className="w-2 h-0.5 bg-gray-600"></div>
                                                                    </div>
                                                                    Clear description
                                                                </button>
                                                                <div className="border border-gray-300 rounded-lg overflow-hidden">
                                                                    <div className="flex items-center gap-2 p-2 border-b border-gray-300 bg-gray-50 text-gray-600">
                                                                        <button className="p-1 hover:bg-gray-200 rounded"><b className="font-serif font-bold">B</b></button>
                                                                        <button className="p-1 hover:bg-gray-200 rounded"><i className="font-serif italic">I</i></button>
                                                                        <button className="p-1 hover:bg-gray-200 rounded"><u className="font-serif underline">U</u></button>
                                                                        <div className="w-px h-4 bg-gray-300 mx-1"></div>
                                                                        <button className="p-1 hover:bg-gray-200 rounded text-xs">Link</button>
                                                                    </div>
                                                                    <textarea
                                                                        placeholder="Enter a description..."
                                                                        value={newTaskDescription}
                                                                        onChange={e => setNewTaskDescription(e.target.value)}
                                                                        className="w-full p-3 text-sm focus:outline-none min-h-[120px] resize-none"
                                                                        maxLength={2000}
                                                                    ></textarea>
                                                                    <div className="p-2 text-right text-xs text-gray-400 border-t border-gray-100">
                                                                        {newTaskDescription.length} / 2000 Characters
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <div>
                                                                <label className="block mb-1.5 text-sm font-medium text-gray-700">Due date and time (IST)</label>
                                                                <div className="flex gap-4">
                                                                    <div className="relative flex-1">
                                                                        <input
                                                                            type="date"
                                                                            value={newTaskDueDate}
                                                                            onChange={e => setNewTaskDueDate(e.target.value)}
                                                                            onClick={(e) => (e.target as any).showPicker?.()}
                                                                            className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue cursor-pointer"
                                                                        />
                                                                    </div>
                                                                    <div className="flex gap-2 items-center flex-1">
                                                                        <div className="flex items-center bg-white border border-gray-300 rounded-lg px-2 py-1 gap-1 flex-1">
                                                                            <select
                                                                                value={getTimeParts(newTaskDueTime).hour12}
                                                                                onChange={e => setNewTaskDueTime(joinTimeParts(parseInt(e.target.value), getTimeParts(newTaskDueTime).minutes, getTimeParts(newTaskDueTime).ampm))}
                                                                                className="bg-transparent border-none p-1 text-sm focus:ring-0 outline-none w-14"
                                                                            >
                                                                                {[...Array(12)].map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                                                                            </select>
                                                                            <span className="text-gray-400">:</span>
                                                                            <select
                                                                                value={getTimeParts(newTaskDueTime).minutes}
                                                                                onChange={e => setNewTaskDueTime(joinTimeParts(getTimeParts(newTaskDueTime).hour12, e.target.value, getTimeParts(newTaskDueTime).ampm))}
                                                                                className="bg-transparent border-none p-1 text-sm focus:ring-0 outline-none w-14"
                                                                            >
                                                                                {['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].map(m => (
                                                                                    <option key={m} value={m}>{m}</option>
                                                                                ))}
                                                                            </select>
                                                                            <select
                                                                                value={getTimeParts(newTaskDueTime).ampm}
                                                                                onChange={e => setNewTaskDueTime(joinTimeParts(getTimeParts(newTaskDueTime).hour12, getTimeParts(newTaskDueTime).minutes, e.target.value))}
                                                                                className="bg-transparent border-none p-1 text-sm font-bold text-brand-blue focus:ring-0 outline-none"
                                                                            >
                                                                                <option value="AM">AM</option>
                                                                                <option value="PM">PM</option>
                                                                            </select>
                                                                            <Clock size={16} className="text-gray-400 ml-auto" />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                                                                <span className="text-sm font-medium text-gray-900">Recurring tasks</span>
                                                                <label className="relative inline-flex items-center cursor-pointer">
                                                                    <input
                                                                        type="checkbox"
                                                                        className="sr-only peer"
                                                                        checked={newTaskIsRecurring}
                                                                        onChange={e => setNewTaskIsRecurring(e.target.checked)}
                                                                    />
                                                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-blue"></div>
                                                                </label>
                                                            </div>

                                                            <div>
                                                                <label className="block mb-1.5 text-sm font-medium text-gray-700">Assign to</label>
                                                                <select
                                                                    value={newTaskAssignee}
                                                                    onChange={e => setNewTaskAssignee(e.target.value)}
                                                                    className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-brand-blue focus:border-brand-blue"
                                                                >
                                                                    <option value="">Select assignee</option>
                                                                    <option value={currentUser?.email || currentUser?.id || 'me'}>Me ({currentUser?.name || 'CurrentUser'})</option>
                                                                    {TEAM_MEMBERS.map(member => (
                                                                        <option key={member.email} value={member.email}>
                                                                            {member.name}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </div>

                                                        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
                                                            <button
                                                                onClick={() => {
                                                                    setIsAddingTask(false);
                                                                    setEditingTaskId(null);
                                                                    setNewTaskTitle('');
                                                                    setNewTaskDescription('');
                                                                }}
                                                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                                                            >
                                                                Cancel
                                                            </button>
                                                            <button
                                                                onClick={handleAddTask}
                                                                className="px-4 py-2 text-sm font-medium text-white bg-brand-blue rounded-lg hover:bg-brand-blue/90"
                                                            >
                                                                {editingTaskId ? 'Update Task' : 'Save'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            
                                        </section>
                                    </div>

                                </div>
                            </div>

                            {/* Modal Footer */}
                            <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center shrink-0">
                                <div className="text-xs text-gray-500">
                                    {editingId && (
                                        <>
                                            <p>Created By: Digital Mojo</p>
                                            <p>Created on: {editingId && opportunities.find(o => o.id === editingId)?.createdAt ? safeFormat(opportunities.find(o => o.id === editingId)?.createdAt, 'MMM d, yyyy h:mm a') : '-'} (IST)</p>
                                            <a href="#" className="text-brand-blue hover:underline flex items-center gap-1 mt-1">
                                                Audit Logs: {editingId} <Download size={12} />
                                            </a>
                                        </>
                                    )}
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setIsModalOpen(false)}
                                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                                        disabled={isSubmitting}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSubmit}
                                        disabled={isSubmitting}
                                        className="px-4 py-2 text-sm font-medium text-white bg-brand-blue rounded-lg hover:bg-brand-blue/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                Saving...
                                            </>
                                        ) : (
                                            editingId ? 'Update' : 'Create'
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }



            {/* Pipeline Modal */}
            <Modal
                isOpen={isPipelineModalOpen}
                onClose={() => setIsPipelineModalOpen(false)}
                title="Edit Pipeline Stages"
                size="2xl"
                footer={
                    <div className="flex items-center justify-end gap-3">
                        <button onClick={() => setIsPipelineModalOpen(false)} className="text-gray-700 bg-white border border-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-100 font-medium rounded-lg text-sm px-5 py-2.5 hover:bg-gray-50">Cancel</button>
                        <button onClick={handleSavePipeline} className="text-white bg-success hover:bg-success/90 focus:ring-4 focus:outline-none focus:ring-green-300 font-medium rounded-lg text-sm px-5 py-2.5">Save Pipeline</button>
                    </div>
                }
            >
                <div className="space-y-4">
                    {tempStages.map((stage, index) => (
                        <div key={index} className="flex items-center gap-4">
                            <div className="w-8 h-8 rounded flex items-center justify-center bg-gray-100 text-gray-500 font-bold">
                                {index + 1}
                            </div>
                            <div className="flex-1">
                                <input
                                    type="text"
                                    value={stage.title}
                                    onChange={(e) => handleStageChange(index, 'title', e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-brand-blue focus:border-brand-blue block p-2.5"
                                    placeholder="Stage Name"
                                />
                            </div>
                            <div>
                                <input
                                    type="color"
                                    value={stage.color}
                                    onChange={(e) => handleStageChange(index, 'color', e.target.value)}
                                    className="h-10 w-14 p-1 bg-gray-50 border border-gray-300 rounded-lg cursor-pointer"
                                />
                            </div>
                            <button
                                onClick={() => handleRemoveStage(index)}
                                className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                            >
                                <Trash2 size={20} />
                            </button>
                        </div>
                    ))}
                </div>
                <button
                    onClick={handleAddStage}
                    className="mt-4 w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 font-bold hover:border-brand-blue hover:text-brand-blue transition-colors flex items-center justify-center gap-2"
                >
                    <Plus size={20} /> Add Stage
                </button>
            </Modal>
        </div >
    );
};

export default Opportunities;
