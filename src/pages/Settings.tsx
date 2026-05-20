import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { Save, Plus, Trash2, GripVertical, FileText, Globe } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import toast from 'react-hot-toast';
import { resetAllTasks } from '../lib/admin';
import { functions } from '../lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { Activity } from 'lucide-react';

interface SortableStageItemProps {
    stage: any;
    onRemove: (id: string) => void;
    onChange: (id: string, title: string) => void;
    onColorChange: (id: string, color: string) => void;
}

const SortableStageItem: React.FC<SortableStageItemProps> = ({ stage, onRemove, onChange, onColorChange }) => {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: stage.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <div ref={setNodeRef} style={style} className="flex items-center gap-3 bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
            <div {...attributes} {...listeners} className="cursor-grab text-gray-400 hover:text-gray-600">
                <GripVertical size={20} />
            </div>
            <input
                type="text"
                value={stage.title}
                onChange={(e) => onChange(stage.id, e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-primary focus:border-primary"
                placeholder="Stage Name"
            />
            <div className="relative w-8 h-8 rounded-full overflow-hidden border border-gray-200 shadow-sm flex-shrink-0">
                <input
                    type="color"
                    value={stage.color}
                    onChange={(e) => onColorChange(stage.id, e.target.value)}
                    className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] p-0 border-0 cursor-pointer"
                />
            </div>
            <button
                onClick={() => onRemove(stage.id)}
                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
            >
                <Trash2 size={18} />
            </button>
        </div>
    );
};

const Settings: React.FC = () => {
    const { stages, updateStages, removeDuplicateContacts, removeDuplicateOpportunities, cleanupLegacySources, clearLeadsByStage, salesAssets, updateSalesAssets } = useStore();
    const [localStages, setLocalStages] = useState(stages);
    const [activeTab, setActiveTab] = useState('pipelines');
    const [isCleaningContacts, setIsCleaningContacts] = useState(false);
    const [isCleaningOpportunities, setIsCleaningOpportunities] = useState(false);
    const [isCleaningSources, setIsCleaningSources] = useState(false);
    const [isCleaningJunk, setIsCleaningJunk] = useState(false);
    const [isCleaningNoBudget, setIsCleaningNoBudget] = useState(false);
    const [isResettingTasks, setIsResettingTasks] = useState(false);

    // AI Backfill States
    const [isScanningBackfill, setIsScanningBackfill] = useState(false);
    const [isBackfilling, setIsBackfilling] = useState(false);
    const [backfillStats, setBackfillStats] = useState<{ pendingCalls: number, pendingLeads: number, scannedLeads: number } | null>(null);
    const [backfillLogs, setBackfillLogs] = useState<string[]>([]);
    const [backfillProgress, setBackfillProgress] = useState({ current: 0, total: 0 });

    const isBackfillingRef = React.useRef(false);

    const handleScanBackfill = async () => {
        setIsScanningBackfill(true);
        try {
            const getBackfillStatus = httpsCallable(functions, 'getBackfillStatus');
            const result: any = await getBackfillStatus();
            setBackfillStats(result.data);
            setBackfillLogs(prev => [...prev, `[System] Scanned ${result.data.scannedLeads} leads. Found ${result.data.pendingCalls} pending calls in ${result.data.pendingLeads} leads.`]);
            if (!isBackfillingRef.current) {
                setBackfillProgress({ current: 0, total: result.data.pendingCalls });
            }
        } catch (err: any) {
            toast.error("Failed to check backfill status");
            setBackfillLogs(prev => [...prev, `[Error] Failed to scan: ${err.message}`]);
        } finally {
            setIsScanningBackfill(false);
        }
    };

    const handleStartBackfill = async () => {
        if (!backfillStats || backfillStats.pendingCalls === 0) return;
        setIsBackfilling(true);
        isBackfillingRef.current = true;
        setBackfillLogs(prev => [...prev, `[System] Starting backfill sequence for ~${backfillStats.pendingCalls} calls...`]);
        setBackfillProgress({ current: 0, total: backfillStats.pendingCalls });
        
        let remainingCalls = backfillStats.pendingCalls;
        let processedTotal = 0;
        
        const aiBackfillBatch = httpsCallable(functions, 'aiBackfillBatch', { timeout: 540000 });
        
        while (remainingCalls > 0 && isBackfillingRef.current) {
            try {
                setBackfillLogs(prev => [...prev, `[System] Requesting next batch (up to 3 leads)...`]);
                const result: any = await aiBackfillBatch({ batchSize: 3 });
                const data = result.data;
                
                processedTotal += data.totalProcessedCalls;
                remainingCalls -= data.totalProcessedCalls;
                
                setBackfillProgress(prev => ({ ...prev, current: processedTotal }));
                
                if (data.errors && data.errors.length > 0) {
                    setBackfillLogs(prev => [...prev, ...data.errors.map((e: string) => `[Error] ${e}`)]);
                }
                if (data.totalSuccessCalls > 0) {
                    setBackfillLogs(prev => [...prev, `[Success] Analyzed ${data.totalSuccessCalls} calls successfully.`]);
                }
                
                if (data.processedLeads === 0) {
                    setBackfillLogs(prev => [...prev, `[System] No more pending calls detected in scan range.`]);
                    break;
                }
                
            } catch (err: any) {
                console.error(err);
                setBackfillLogs(prev => [...prev, `[Fatal Error] Batch failed: ${err.message}`]);
                break; // Stop on fatal error
            }
        }
        
        setBackfillLogs(prev => [...prev, `[System] Backfill sequence finished.`]);
        setIsBackfilling(false);
        isBackfillingRef.current = false;
        
        handleScanBackfill();
    };

    const handleStopBackfill = () => {
        isBackfillingRef.current = false;
        setIsBackfilling(false);
        setBackfillLogs(prev => [...prev, `[System] Stopping after current batch finishes...`]);
    };

    // Sync local stages with store stages when they update (e.g. from real-time listener)
    React.useEffect(() => {
        setLocalStages(stages);
    }, [stages]);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setLocalStages((items) => {
                const oldIndex = items.findIndex((i) => i.id === active.id);
                const newIndex = items.findIndex((i) => i.id === over.id);
                return arrayMove(items, oldIndex, newIndex);
            });
        }
    };

    const handleStageChange = (id: string, newTitle: string) => {
        setLocalStages(localStages.map(s => s.id === id ? { ...s, title: newTitle } : s));
    };

    const handleStageColorChange = (id: string, newColor: string) => {
        setLocalStages(localStages.map(s => s.id === id ? { ...s, color: newColor } : s));
    };

    const handleAddStage = () => {
        const newStage = {
            id: `stage-${Date.now()}`,
            title: 'New Stage',
            color: '#E2E8F0',
            order: localStages.length
        };
        setLocalStages([...localStages, newStage]);
    };

    const handleRemoveStage = (id: string) => {
        if (localStages.length <= 1) {
            toast.error('You must have at least one stage');
            return;
        }
        setLocalStages(localStages.filter(s => s.id !== id));
    };

    const handleSave = async () => {
        try {
            await updateStages(localStages);
            toast.success('Settings saved successfully');
        } catch (error) {
            toast.error('Failed to save settings');
        }
    };

    return (
        <div className="p-4 md:p-8 h-full flex flex-col bg-gray-50/50 overflow-y-auto">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-6 md:mb-8">
                <h1 className="text-xl md:text-3xl font-bold text-gray-900">Settings</h1>
                <button
                    onClick={handleSave}
                    className="flex items-center justify-center gap-2 bg-primary text-black px-6 py-2.5 rounded-lg font-bold hover:bg-primary/90 shadow-sm transition-all text-sm">
                    <Save size={18} />
                    Save Changes
                </button>
            </div>

            <div className="flex flex-col md:flex-row gap-4 md:gap-8 flex-1 min-h-0">
                {/* Sidebar */}
                <div className="w-full md:w-64 flex-shrink-0">
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex md:flex-col">
                        <button
                            onClick={() => setActiveTab('pipelines')}
                            className={`flex-1 md:flex-none text-center md:text-left px-4 py-3 text-xs md:text-sm font-bold border-b-2 md:border-b-0 md:border-l-4 transition-colors ${activeTab === 'pipelines'
                                ? 'border-primary bg-primary/5 text-black'
                                : 'border-transparent text-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            Pipelines
                        </button>
                        <button
                            onClick={() => setActiveTab('cleanup')}
                            className={`flex-1 md:flex-none text-center md:text-left px-4 py-3 text-xs md:text-sm font-bold border-b-2 md:border-b-0 md:border-l-4 transition-colors ${activeTab === 'cleanup'
                                ? 'border-primary bg-primary/5 text-black'
                                : 'border-transparent text-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            Cleanup
                        </button>
                        <button
                            onClick={() => setActiveTab('assets')}
                            className={`flex-1 md:flex-none text-center md:text-left px-4 py-3 text-xs md:text-sm font-bold border-b-2 md:border-b-0 md:border-l-4 transition-colors ${activeTab === 'assets'
                                ? 'border-primary bg-primary/5 text-black'
                                : 'border-transparent text-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            Sales Assets
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6 overflow-y-auto mb-20 md:mb-0">
                    {activeTab === 'pipelines' && (
                        <div className="max-w-2xl">
                            <div className="flex justify-between items-center mb-6">
                                <div>
                                    <h2 className="text-xl font-bold text-gray-900">Pipeline Stages</h2>
                                    <p className="text-sm text-gray-500 mt-1">Customize the stages of your sales pipeline</p>
                                </div>
                                <button
                                    onClick={handleAddStage}
                                    className="text-black hover:bg-primary/10 px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1"
                                >
                                    <Plus size={16} /> Add Stage
                                </button>
                            </div>

                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleDragEnd}
                            >
                                <SortableContext
                                    items={localStages.map(s => s.id)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    <div className="space-y-3">
                                        {localStages.map((stage) => (
                                            <SortableStageItem
                                                key={stage.id}
                                                stage={stage}
                                                onRemove={handleRemoveStage}
                                                onChange={handleStageChange}
                                                onColorChange={handleStageColorChange}
                                            />
                                        ))}
                                    </div>
                                </SortableContext>
                            </DndContext>
                        </div>
                    )}

                    {activeTab === 'team' && (
                        <div className="text-center py-20">
                            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Users size={32} className="text-gray-400" />
                            </div>
                            <h3 className="text-lg font-medium text-gray-900">Team Management</h3>
                            <p className="text-gray-500 mt-2">Invite and manage team members (Coming Soon)</p>
                        </div>
                    )}

                    {activeTab === 'profile' && (
                        <div className="text-center py-20">
                            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Users size={32} className="text-gray-400" />
                            </div>
                            <h3 className="text-lg font-medium text-gray-900">Company Profile</h3>
                            <p className="text-gray-500 mt-2">Manage company details and branding (Coming Soon)</p>
                        </div>
                    )}

                    {activeTab === 'assets' && (
                        <div className="max-w-2xl">
                            <div className="mb-6">
                                <h2 className="text-xl font-bold text-gray-900">Sales Assets</h2>
                                <p className="text-sm text-gray-500 mt-1">Configure your marketing decks and discovery forms for automated delivery</p>
                            </div>

                            <div className="space-y-6">
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                                            <FileText size={16} className="text-primary" />
                                            Sales Deck Part 1 (PDF URL)
                                        </label>
                                        <input
                                            type="url"
                                            value={salesAssets?.pdf1Url || ''}
                                            onChange={(e) => updateSalesAssets({ 
                                                pdf1Url: e.target.value,
                                                pdf2Url: salesAssets?.pdf2Url || '',
                                                formUrl: salesAssets?.formUrl || ''
                                            })}
                                            placeholder="https://storage.googleapis.com/..."
                                            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                                            <FileText size={16} className="text-primary" />
                                            Sales Deck Part 2 (PDF URL)
                                        </label>
                                        <input
                                            type="url"
                                            value={salesAssets?.pdf2Url || ''}
                                            onChange={(e) => updateSalesAssets({ 
                                                pdf1Url: salesAssets?.pdf1Url || '',
                                                pdf2Url: e.target.value,
                                                formUrl: salesAssets?.formUrl || ''
                                            })}
                                            placeholder="https://storage.googleapis.com/..."
                                            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                                            <Globe size={16} className="text-primary" />
                                            Discovery Form URL
                                        </label>
                                        <input
                                            type="url"
                                            value={salesAssets?.formUrl || ''}
                                            onChange={(e) => updateSalesAssets({ 
                                                pdf1Url: salesAssets?.pdf1Url || '',
                                                pdf2Url: salesAssets?.pdf2Url || '',
                                                formUrl: e.target.value
                                            })}
                                            placeholder="https://docs.google.com/forms/..."
                                            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                                        />
                                    </div>
                                </div>

                                <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
                                    <h4 className="font-bold text-sm text-gray-900 mb-1 flex items-center gap-2">
                                        <Activity size={16} className="text-primary" />
                                        How it works
                                    </h4>
                                    <p className="text-xs text-gray-600 leading-relaxed">
                                        When you click "Send Sales Assets" on a lead, the system will automatically fetch these URLs and send them as sequential WhatsApp messages using your Wati templates.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'cleanup' && (
                        <div className="max-w-2xl">
                            <div className="mb-6">
                                <h2 className="text-xl font-bold text-gray-900">Data Cleanup</h2>
                                <p className="text-sm text-gray-500 mt-1">Remove duplicate records from your database</p>
                            </div>

                            <div className="space-y-4">
                                {/* Remove Duplicate Contacts */}
                                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <h3 className="font-medium text-gray-900">Remove Duplicate Contacts</h3>
                                            <p className="text-sm text-gray-500 mt-1">
                                                Finds contacts with the same email or name and removes duplicates, keeping the oldest record.
                                            </p>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                setIsCleaningContacts(true);
                                                try {
                                                    const result = await removeDuplicateContacts();
                                                    toast.success(`Removed ${result.removed} duplicate contacts. ${result.kept} unique contacts remain.`);
                                                } catch (error) {
                                                    toast.error('Failed to remove duplicate contacts');
                                                }
                                                setIsCleaningContacts(false);
                                            }}
                                            disabled={isCleaningContacts}
                                            className="px-4 py-2 bg-brand-orange text-white rounded-lg font-medium hover:bg-brand-orange/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            {isCleaningContacts ? (
                                                <>
                                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                    Cleaning...
                                                </>
                                            ) : (
                                                <>
                                                    <Trash2 size={16} />
                                                    Clean Contacts
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* Remove Duplicate Opportunities */}
                                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <h3 className="font-medium text-gray-900">Remove Duplicate Opportunities</h3>
                                            <p className="text-sm text-gray-500 mt-1">
                                                Finds opportunities with the same name and linked contact, and removes duplicates, keeping the oldest record.
                                            </p>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                setIsCleaningOpportunities(true);
                                                try {
                                                    const result = await removeDuplicateOpportunities();
                                                    toast.success(`Removed ${result.removed} duplicate opportunities. ${result.kept} unique opportunities remain.`);
                                                } catch (error) {
                                                    toast.error('Failed to remove duplicate opportunities');
                                                }
                                                setIsCleaningOpportunities(false);
                                            }}
                                            disabled={isCleaningOpportunities}
                                            className="px-4 py-2 bg-brand-orange text-white rounded-lg font-medium hover:bg-brand-orange/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            {isCleaningOpportunities ? (
                                                <>
                                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                    Cleaning...
                                                </>
                                            ) : (
                                                <>
                                                    <Trash2 size={16} />
                                                    Clean Opportunities
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* Clear All Opportunity Sources */}
                                <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <h3 className="font-medium text-gray-900">Clear All Opportunity Sources</h3>
                                            <p className="text-sm text-gray-500 mt-1">
                                                Clears the 'Source' field for ALL opportunities in the system. Use this if you want to completely reset lead origins.
                                            </p>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                if (!window.confirm('⚠️ Are you sure you want to clear the Source field for ALL opportunities? This action cannot be undone.')) {
                                                    return;
                                                }
                                                setIsCleaningSources(true);
                                                try {
                                                    const result = await cleanupLegacySources(); // No date passed = clear all
                                                    toast.success(`Successfully cleared sources for ${result.updated} opportunities.`);
                                                } catch (error) {
                                                    toast.error('Failed to clear sources');
                                                }
                                                setIsCleaningSources(false);
                                            }}
                                            disabled={isCleaningSources}
                                            className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            {isCleaningSources ? (
                                                <>
                                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                    Clearing...
                                                </>
                                            ) : (
                                                <>
                                                    <Trash2 size={16} />
                                                    Clear All Sources
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* Clear Junk Leads */}
                                <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <h3 className="font-medium text-gray-900">Clear Junk Leads</h3>
                                            <p className="text-sm text-gray-500 mt-1">
                                                Permanently delete all opportunities currently in the "0 - Junk" stage.
                                            </p>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                if (!window.confirm('⚠️ Are you sure you want to delete ALL Junk leads? This action cannot be undone!')) {
                                                    return;
                                                }
                                                setIsCleaningJunk(true);
                                                try {
                                                    const result = await clearLeadsByStage('0');
                                                    if (result.success) {
                                                        toast.success(`Successfully removed ${result.removed} junk leads`);
                                                    }
                                                } catch (error) {
                                                    toast.error('Failed to clear junk leads');
                                                }
                                                setIsCleaningJunk(false);
                                            }}
                                            disabled={isCleaningJunk}
                                            className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            {isCleaningJunk ? (
                                                <>
                                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                    Clearing...
                                                </>
                                            ) : (
                                                <>
                                                    <Trash2 size={16} />
                                                    Clear Junk Leads
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* Clear No Budget Leads */}
                                <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <h3 className="font-medium text-gray-900">Clear No Budget Leads</h3>
                                            <p className="text-sm text-gray-500 mt-1">
                                                Permanently delete all opportunities currently in the "0.5 - No Budget" stage.
                                            </p>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                if (!window.confirm('⚠️ Are you sure you want to delete ALL No Budget leads? This action cannot be undone!')) {
                                                    return;
                                                }
                                                setIsCleaningNoBudget(true);
                                                try {
                                                    const result = await clearLeadsByStage('0.5');
                                                    if (result.success) {
                                                        toast.success(`Successfully removed ${result.removed} no-budget leads`);
                                                    }
                                                } catch (error) {
                                                    toast.error('Failed to clear no-budget leads');
                                                }
                                                setIsCleaningNoBudget(false);
                                            }}
                                            disabled={isCleaningNoBudget}
                                            className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            {isCleaningNoBudget ? (
                                                <>
                                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                    Clearing...
                                                </>
                                            ) : (
                                                <>
                                                    <Trash2 size={16} />
                                                    Clear No Budget Leads
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* Reset All Tasks */}
                                <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <h3 className="font-medium text-gray-900">Reset All Tasks</h3>
                                            <p className="text-sm text-gray-500 mt-1">
                                                Removes all tasks from all opportunities. This will make your task list completely clean and fresh.
                                            </p>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                if (!window.confirm('⚠️ Are you sure you want to reset ALL tasks? This will permanently delete all tasks from all opportunities. This action cannot be undone!')) {
                                                    return;
                                                }
                                                setIsResettingTasks(true);
                                                try {
                                                    const result = await resetAllTasks();
                                                    if (result.success) {
                                                        toast.success(result.message);
                                                    } else {
                                                        toast.error(result.message);
                                                    }
                                                } catch (error) {
                                                    toast.error('Failed to reset tasks');
                                                }
                                                setIsResettingTasks(false);
                                            }}
                                            disabled={isResettingTasks}
                                            className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            {isResettingTasks ? (
                                                <>
                                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                    Resetting...
                                                </>
                                            ) : (
                                                <>
                                                    <Trash2 size={16} />
                                                    Reset All Tasks
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* AI Call Analysis Backfill */}
                                <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-lg">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="font-medium text-gray-900 flex items-center gap-2">
                                                <Activity size={18} className="text-indigo-600" />
                                                Automated AI Call Analysis Backfill
                                            </h3>
                                            <p className="text-sm text-gray-500 mt-1 max-w-lg">
                                                Scan the top 500 recently modified opportunities to find audio recordings missing AI analysis. 
                                                You can then process them sequentially within the Gemini API limits.
                                            </p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={handleScanBackfill}
                                                disabled={isScanningBackfill || isBackfilling}
                                                className="px-3 py-1.5 bg-white border border-indigo-300 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-100 disabled:opacity-50"
                                            >
                                                {isScanningBackfill ? 'Scanning...' : 'Scan Status'}
                                            </button>
                                            
                                            {isBackfilling ? (
                                                <button
                                                    onClick={handleStopBackfill}
                                                    className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
                                                >
                                                    Stop Batch
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={handleStartBackfill}
                                                    disabled={!backfillStats || backfillStats.pendingCalls === 0}
                                                    className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                                                >
                                                    Start Backfill
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {backfillStats && (
                                        <div className="bg-white p-3 rounded border border-indigo-100 mb-3 text-sm flex gap-6">
                                            <div><span className="text-gray-500">Scanned Leads:</span> <span className="font-semibold text-gray-900">{backfillStats.scannedLeads}</span></div>
                                            <div><span className="text-gray-500">Missing AI Analysis:</span> <span className="font-semibold text-red-600">{backfillStats.pendingCalls} recordings</span></div>
                                            <div><span className="text-gray-500">Affected Leads:</span> <span className="font-semibold text-indigo-600">{backfillStats.pendingLeads}</span></div>
                                        </div>
                                    )}

                                    {/* Progress Bar */}
                                    {backfillProgress.total > 0 && (
                                        <div className="mb-4">
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="font-medium text-indigo-700">Progress</span>
                                                <span className="text-gray-600">{backfillProgress.current} / {backfillProgress.total}</span>
                                            </div>
                                            <div className="w-full bg-indigo-200 rounded-full h-2">
                                                <div 
                                                    className="bg-indigo-600 h-2 rounded-full transition-all duration-500" 
                                                    style={{ width: `${Math.min(100, (backfillProgress.current / backfillProgress.total) * 100)}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                    )}
                                    
                                    {/* Log Window */}
                                    {backfillLogs.length > 0 && (
                                        <div className="bg-gray-900 rounded-md p-3 font-mono text-[11px] h-32 overflow-y-auto text-gray-300 flex flex-col-reverse">
                                            {/* Reversed order inside a flex-col-reverse to show latest logs at the bottom automatically */}
                                            {[...backfillLogs].reverse().map((log, i) => (
                                                <div key={i} className={`py-0.5 ${log.includes('[Error]') || log.includes('[Fatal') ? 'text-red-400' : log.includes('[Success]') ? 'text-green-400' : 'text-gray-400'}`}>
                                                    {log}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-6">
                                    <p className="text-sm text-yellow-800">
                                        <strong>Warning:</strong> This action cannot be undone. Make sure you have a backup of your data before proceeding.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// Helper icon component for empty states
const Users = ({ size, className }: { size: number, className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    </svg>
);

export default Settings;
