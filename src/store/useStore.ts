import { create } from 'zustand';
import { Contact, Opportunity, Appointment, Conversation, Notification, Message, User, LoginLog, DiscoveryResponse } from '../types';
import { api } from '../services/api';
import { auth } from '../lib/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { isUserAllowed } from '../lib/admin';
import { isDemoMode, DEFAULT_STAGES } from '../lib/demoData';

interface AppState {
    currentUser: User | null;
    isLoadingAuth: boolean;
    setCurrentUser: (user: User | null) => void;
    logout: () => Promise<void>;
    initializeAuthListener: () => void;

    contacts: Contact[];
    opportunities: Opportunity[];
    appointments: Appointment[];
    isLoading: boolean;
    lastContactDoc: any;
    hasMoreContacts: boolean;

    fetchContacts: () => Promise<void>;
    fetchContact: (id: string) => Promise<Contact | null>;
    searchContacts: (term: string) => Promise<void>;
    loadMoreContacts: () => Promise<void>;
    addContact: (contact: Omit<Contact, 'id'>) => Promise<Contact>;
    updateContact: (id: string, contact: Partial<Contact>) => Promise<void>;
    deleteContact: (id: string) => Promise<void>;
    bulkDeleteContacts: (ids: string[]) => Promise<void>;


    stages: { id: string; title: string; color: string }[];
    stageCounts: Record<string, { count: number; value: number }>;
    stagePagination: Record<string, { lastDoc: any; hasMore: boolean; isLoading: boolean }>;
    fetchOpportunities: () => Promise<void>;
    fetchOpportunitiesByStage: (stageId: string) => Promise<void>;
    loadMoreByStage: (stageId: string) => Promise<void>;
    lastOpportunityDoc: any;
    hasMoreOpportunities: boolean;
    loadMoreOpportunities: () => Promise<void>;
    addOpportunity: (opp: Omit<Opportunity, 'id'>) => Promise<void>;
    updateOpportunity: (id: string, opp: Partial<Opportunity>) => Promise<void>;
    deleteOpportunity: (id: string) => Promise<void>;
    bulkDeleteOpportunities: (ids: string[]) => Promise<void>;
    updateStages: (stages: { id: string; title: string; color: string }[]) => Promise<void>;
    fetchStageCounts: () => Promise<void>;

    fetchAppointments: () => Promise<void>;
    addAppointment: (apt: Omit<Appointment, 'id'>) => Promise<void>;
    updateAppointment: (id: string, apt: Partial<Appointment>) => Promise<void>;
    deleteAppointment: (id: string) => Promise<void>;

    conversations: Conversation[];
    activeConversationId: string | null;
    setActiveConversation: (id: string) => void;
    fetchConversations: () => Promise<void>;
    sendMessage: (conversationId: string, text: string) => Promise<void>;
    createConversation: (contactId: string, contactName: string) => Promise<void>;

    notifications: Notification[];
    fetchNotifications: () => Promise<void>;

    loginLogs: LoginLog[];
    fetchLoginLogs: () => Promise<void>;

    // Dashboard Stats
    dashboardStats: {
        totalOpportunities: number;
        totalPipelineValue: number;
        wonOpportunities: number;
        lostOpportunities: number;
        openOpportunities: number;
        conversionRate: number;
        stageBreakdown: Record<string, { count: number; value: number }>;
        pipelineTrend: { name: string; value: number }[];
        taskStats: { completed: number; pending: number; total: number };
        recentOpportunities: Opportunity[];
        allOpportunities: Opportunity[];
    } | null;
    fetchDashboardStats: (daysBack: number) => Promise<void>;

    // Data Cleanup
    removeDuplicateContacts: () => Promise<{ removed: number; kept: number }>;
    removeDuplicateOpportunities: () => Promise<{ removed: number; kept: number }>;
    cleanupLegacySources: (cutoffDate?: string) => Promise<{ updated: number }>;
    clearLeadsByStage: (stageId: string) => Promise<{ success: boolean; removed: number }>;

    // Google Integration
    googleToken: string | null;
    setGoogleToken: (token: string | null) => void;

    // Sales Assets
    salesAssets: { pdf1Url: string, pdf2Url: string, formUrl: string } | null;
    fetchSalesAssets: () => Promise<void>;
    updateSalesAssets: (data: { pdf1Url: string, pdf2Url: string, formUrl: string }) => Promise<void>;
    sendSalesAssets: (opportunityId: string) => Promise<void>;

    // Discovery Form
    discoveryResponses: DiscoveryResponse[];
    fetchDiscoveryResponses: (phone: string) => Promise<void>;

    initializeListeners: () => void;
}

export const useStore = create<AppState>((set, get) => ({
    currentUser: null,
    isLoadingAuth: true,
    setCurrentUser: (user) => set({ currentUser: user }),
    discoveryResponses: [],
    logout: async () => {
        if (!isDemoMode()) {
            await signOut(auth);
        }
        get().setGoogleToken(null);
        set({
            currentUser: null,
            contacts: [],
            opportunities: [],
            appointments: [],
            conversations: [],
            notifications: []
        });
    },
    initializeAuthListener: () => {
        if (isDemoMode()) {
            // Demo mode: set demo user immediately
            set({
                currentUser: {
                    id: 'demo_user',
                    name: 'Demo User',
                    email: 'demo@example.com',
                    avatar: 'https://ui-avatars.com/api/?name=Demo+User&background=random'
                },
                isLoadingAuth: false
            });
            get().initializeListeners();
            return;
        }

        onAuthStateChanged(auth, (user) => {
            if (user) {
                // ACTIVE SECURITY: If user is logged in but no longer on the whitelist, kick them out
                if (!isUserAllowed(user.email)) {
                    signOut(auth);
                    set({
                        currentUser: null,
                        isLoadingAuth: false
                    });
                    return;
                }

                set({
                    currentUser: {
                        id: user.uid,
                        name: user.displayName || user.email?.split('@')[0] || 'User',
                        email: user.email || '',
                        avatar: user.photoURL || `https://ui-avatars.com/api/?name=${user.email}&background=random`
                    },
                    isLoadingAuth: false
                });
                get().initializeListeners();
            } else {
                set({
                    currentUser: null,
                    isLoadingAuth: false,
                    contacts: [],
                    opportunities: [],
                    appointments: [],
                    conversations: []
                });
            }
        });
    },

    contacts: [],
    opportunities: [],
    stages: DEFAULT_STAGES,
    stageCounts: {},
    stagePagination: {},
    updateStages: async (stages) => {
        await api.pipelines.update(stages);
        set({ stages });
    },
    fetchStageCounts: async () => {
        const counts = await api.opportunities.getStageCounts();
        set({ stageCounts: counts });
    },
    fetchOpportunitiesByStage: async (stageId: string) => {
        const pagination = get().stagePagination[stageId];
        if (pagination?.isLoading) return;

        set((state) => ({
            stagePagination: {
                ...state.stagePagination,
                [stageId]: { ...state.stagePagination[stageId], isLoading: true }
            }
        }));

        try {
            const result = await api.opportunities.getByStage(stageId, undefined, 10);
            set((state) => {
                // Deduplicate: remove existing opportunities for this stage, add new ones, then deduplicate global array
                const otherOpps = state.opportunities.filter(o => o.stage !== stageId);
                const updatedOpps = [...otherOpps, ...result.data];

                // Final safety deduplication by ID
                const uniqueOpps = Array.from(new Map(updatedOpps.map(o => [o.id, o])).values());

                return {
                    opportunities: uniqueOpps,
                    stagePagination: {
                        ...state.stagePagination,
                        [stageId]: {
                            lastDoc: result.lastDoc,
                            hasMore: result.hasMore,
                            isLoading: false
                        }
                    }
                };
            });
        } catch (error) {
            console.error('Error fetching opportunities by stage:', error);
            set((state) => ({
                stagePagination: {
                    ...state.stagePagination,
                    [stageId]: { ...state.stagePagination[stageId], isLoading: false }
                }
            }));
        }
    },
    loadMoreByStage: async (stageId: string) => {
        const pagination = get().stagePagination[stageId];
        if (!pagination || pagination.isLoading || !pagination.hasMore) return;

        set((state) => ({
            stagePagination: {
                ...state.stagePagination,
                [stageId]: { ...state.stagePagination[stageId], isLoading: true }
            }
        }));

        try {
            const result = await api.opportunities.getByStage(stageId, pagination.lastDoc, 10);
            set((state) => {
                // Add new opportunities and deduplicate by ID
                const combined = [...state.opportunities, ...result.data];
                const uniqueOpps = Array.from(new Map(combined.map(o => [o.id, o])).values());

                return {
                    opportunities: uniqueOpps,
                    stagePagination: {
                        ...state.stagePagination,
                        [stageId]: {
                            lastDoc: result.lastDoc,
                            hasMore: result.hasMore,
                            isLoading: false
                        }
                    }
                };
            });
        } catch (error) {
            console.error('Error loading more opportunities by stage:', error);
            set((state) => ({
                stagePagination: {
                    ...state.stagePagination,
                    [stageId]: { ...state.stagePagination[stageId], isLoading: false }
                }
            }));
        }
    },
    appointments: [],
    conversations: [],
    activeConversationId: null,
    notifications: [],

    // Dashboard Stats
    dashboardStats: null,
    fetchDashboardStats: async (daysBack: number) => {
        try {
            const stats = await api.opportunities.getDashboardStats(daysBack);
            set({
                dashboardStats: {
                    totalOpportunities: stats.totalOpportunities,
                    totalPipelineValue: stats.totalPipelineValue,
                    wonOpportunities: stats.wonOpportunities,
                    lostOpportunities: stats.lostOpportunities,
                    openOpportunities: stats.openOpportunities,
                    conversionRate: stats.conversionRate,
                    stageBreakdown: stats.stageBreakdown,
                    pipelineTrend: stats.pipelineTrend,
                    taskStats: stats.taskStats,
                    recentOpportunities: stats.recentOpportunities || [],
                    allOpportunities: stats.allOpportunities || []
                }
            });
        } catch (error) {
            console.error('Error fetching dashboard stats:', error);
        }
    },

    googleToken: localStorage.getItem('google_calendar_token'),
    setGoogleToken: (token) => {
        if (token) {
            localStorage.setItem('google_calendar_token', token);
        } else {
            localStorage.removeItem('google_calendar_token');
        }
        set({ googleToken: token });
    },

    // Data Cleanup Functions
    removeDuplicateContacts: async () => {
        const result = await api.contacts.removeDuplicates();
        // Refresh contacts after cleanup
        get().fetchContacts();
        return result;
    },
    removeDuplicateOpportunities: async () => {
        const result = await api.opportunities.removeDuplicates();
        // Refresh opportunities and counts after cleanup
        get().fetchOpportunities();
        get().fetchStageCounts();
        return result;
    },
    cleanupLegacySources: async (cutoffDate: string) => {
        const result = await api.opportunities.cleanupLegacySources(cutoffDate);
        // Refresh opportunities after cleanup
        get().fetchOpportunities();
        return result;
    },
    clearLeadsByStage: async (stageId: string) => {
        const result = await api.opportunities.clearLeadsByStage(stageId);
        // Refresh opportunities after cleanup
        get().fetchOpportunities();
        return result;
    },

    isLoading: false,
    lastContactDoc: null,
    hasMoreContacts: false,

    fetchContacts: async () => {
        set({ isLoading: true });
        const userId = get().currentUser?.id;
        const { data, lastDoc } = await api.contacts.getAll(userId, null, 20);
        set({
            contacts: data,
            lastContactDoc: lastDoc,
            hasMoreContacts: data.length === 20,
            isLoading: false
        });
    },
    fetchContact: async (id: string) => {
        const contact = await api.contacts.get(id);
        if (contact) {
            set((state) => {
                if (state.contacts.some(c => c.id === contact.id)) {
                    return { contacts: state.contacts.map(c => c.id === contact.id ? contact : c) };
                }
                return { contacts: [contact, ...state.contacts] };
            });
            return contact;
        }
        return null;
    },
    searchContacts: async (term: string) => {
        set({ isLoading: true });
        const userId = get().currentUser?.id;
        if (!term) {
            // If search is cleared, fetch initial page again
            const { data, lastDoc } = await api.contacts.getAll(userId, null, 20);
            set({
                contacts: data,
                lastContactDoc: lastDoc,
                hasMoreContacts: data.length === 20,
                isLoading: false
            });
            return;
        }

        try {
            const results = await api.contacts.search(userId, term);
            set({
                contacts: results,
                hasMoreContacts: false, // Search results are not paginated for now
                isLoading: false
            });
        } catch (error) {
            console.error("Search failed", error);
            // Fallback to client-side filter if index is missing
            const allContacts = get().contacts;
            const filtered = allContacts.filter(c => c.name.toLowerCase().includes(term.toLowerCase()));
            set({ contacts: filtered, isLoading: false });
        }
    },
    loadMoreContacts: async () => {
        const { lastContactDoc, contacts, currentUser, hasMoreContacts } = get();
        if (!hasMoreContacts || !lastContactDoc) return;

        const { data, lastDoc } = await api.contacts.getAll(currentUser?.id, lastContactDoc, 20);
        set({
            contacts: [...contacts, ...data],
            lastContactDoc: lastDoc,
            hasMoreContacts: data.length === 20
        });
    },
    addContact: async (contact) => {
        const newContact = await api.contacts.create(contact);
        set((state) => {
            // Check if contact already exists in state to prevent duplicates
            if (state.contacts.some(c => c.id === newContact.id)) {
                return { contacts: state.contacts };
            }
            return { contacts: [newContact, ...state.contacts] };
        });
        return newContact;
    },
    updateContact: async (id, contact) => {
        await api.contacts.update(id, contact);
        set((state) => ({
            contacts: state.contacts.map((c) => (c.id === id ? { ...c, ...contact } : c)),
        }));
    },
    deleteContact: async (id) => {
        // First, find and delete any opportunities linked to this contact
        const linkedOpportunities = get().opportunities.filter(o => o.contactId === id);
        for (const opp of linkedOpportunities) {
            await api.opportunities.delete(opp.id);
        }
        // Update local state to remove deleted opportunities
        if (linkedOpportunities.length > 0) {
            set((state) => ({
                opportunities: state.opportunities.filter((o) => o.contactId !== id),
            }));
            // Refresh stage counts after deleting opportunities
            get().fetchStageCounts();
        }

        // Now delete the contact
        await api.contacts.delete(id);
        set((state) => ({
            contacts: state.contacts.filter((c) => c.id !== id),
        }));
    },
    bulkDeleteContacts: async (ids: string[]) => {
        await api.contacts.bulkDelete(ids);
        set((state) => ({
            contacts: state.contacts.filter((c) => !ids.includes(c.id)),
        }));
    },


    lastOpportunityDoc: null,
    hasMoreOpportunities: false,

    fetchOpportunities: async () => {
        set({ isLoading: true });
        const userId = get().currentUser?.id;
        try {
            const { data, lastDoc } = await api.opportunities.getAll(userId, null, 20);

            set((state) => {
                // Merge new data with existing opportunities to prevent data loss (e.g. from Board View)
                const existingMap = new Map(state.opportunities.map(o => [o.id, o]));

                // Update or add new items
                data.forEach(opp => {
                    existingMap.set(opp.id, opp);
                });

                // Convert back to array
                const mergedOpportunities = Array.from(existingMap.values());

                return {
                    opportunities: mergedOpportunities,
                    lastOpportunityDoc: lastDoc,
                    hasMoreOpportunities: data.length === 20,
                    isLoading: false
                };
            });
        } catch (error) {
            console.error("Error fetching opportunities:", error);
            set({ isLoading: false });
        }
    },
    loadMoreOpportunities: async () => {
        const { lastOpportunityDoc, opportunities, currentUser, hasMoreOpportunities } = get();
        if (!hasMoreOpportunities || !lastOpportunityDoc) return;

        try {
            const { data, lastDoc } = await api.opportunities.getAll(currentUser?.id, lastOpportunityDoc, 20);
            set({
                // Merge and deduplicate
                opportunities: Array.from(new Map([...opportunities, ...data].map(o => [o.id, o])).values()),
                lastOpportunityDoc: lastDoc,
                hasMoreOpportunities: data.length === 20
            });
        } catch (error) {
            console.error("Error loading more opportunities:", error);
        }
    },
    addOpportunity: async (opp) => {
        const currentUser = get().currentUser;
        const oppData = {
            ...opp,
            activities: currentUser ? [{
                id: Date.now().toString() + '_create',
                type: 'status_change' as const,
                description: 'Opportunity created',
                timestamp: new Date().toISOString(),
                userId: currentUser.id,
                userName: currentUser.name
            }] : []
        };
        const newOpp = await api.opportunities.create(oppData);
        set((state) => {
            // Check if opportunity already exists in state to prevent duplicates
            if (state.opportunities.some(o => o.id === newOpp.id)) {
                return { opportunities: state.opportunities };
            }
            return { opportunities: [...state.opportunities, newOpp] };
        });
        // Refresh stage counts after adding
        get().fetchStageCounts();
    },
    updateOpportunity: async (id, opp) => {
        // Enforce Task Permissions
        if (opp.tasks) {
            const currentUser = get().currentUser;
            const existingOpp = get().opportunities.find(o => o.id === id);

            if (existingOpp && existingOpp.tasks && currentUser) {
                // 1. Check for Deleted Tasks
                const newIds = new Set(opp.tasks.map(t => t.id));
                const deletedTasks = existingOpp.tasks.filter(t => !newIds.has(t.id));

                for (const task of deletedTasks) {
                    // Only creator can delete
                    // If task has no createdBy (legacy), allow deletion
                    if (task.createdBy && task.createdBy !== currentUser.id && task.createdBy !== currentUser.email) {
                        const errorMsg = `Permission denied: You cannot delete task "${task.title}" because you did not create it.`;
                        console.error(errorMsg);
                        throw new Error(errorMsg);
                    }
                }

                // 2. Check for Edited Tasks
                for (const newTask of opp.tasks) {
                    const oldTask = existingOpp.tasks.find(t => t.id === newTask.id);
                    if (oldTask) {
                        // Task exists, check if it was modified
                        const isModified = JSON.stringify(newTask) !== JSON.stringify(oldTask);

                        if (isModified) {
                            const isCreator = !oldTask.createdBy || oldTask.createdBy === currentUser.id || oldTask.createdBy === currentUser.email;
                            const isAssignee = oldTask.assignee === currentUser.id || oldTask.assignee === currentUser.email;

                            // Check if only completion status changed
                            const onlyCompletionChanged =
                                newTask.isCompleted !== oldTask.isCompleted &&
                                newTask.title === oldTask.title &&
                                newTask.description === oldTask.description &&
                                newTask.dueDate === oldTask.dueDate &&
                                newTask.dueTime === oldTask.dueTime &&
                                newTask.assignee === oldTask.assignee;

                            if (!isCreator) {
                                if (onlyCompletionChanged) {
                                    if (!isAssignee) {
                                        const errorMsg = `Permission denied: You cannot complete task "${newTask.title}" because it is not assigned to you.`;
                                        console.error(errorMsg);
                                        throw new Error(errorMsg);
                                    }
                                } else {
                                    const errorMsg = `Permission denied: You cannot edit task "${newTask.title}" because you did not create it.`;
                                    console.error(errorMsg);
                                    throw new Error(errorMsg);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Reset followUpRead if followUpDate is updated to a new value
        if (opp.followUpDate !== undefined) {
            opp.followUpRead = false;
        }

        // --- Lead Movement Tracking ---
        const existingOpp = get().opportunities.find(o => o.id === id);
        const currentUser = get().currentUser;
        if (existingOpp && currentUser) {
            const newActivities: any[] = [...(existingOpp.activities || [])];
            let activityAdded = false;

            // Track Stage Change
            if (opp.stage !== undefined && opp.stage !== existingOpp.stage) {
                const oldStageName = get().stages.find(s => s.id === existingOpp.stage)?.title || existingOpp.stage;
                const newStageName = get().stages.find(s => s.id === opp.stage)?.title || opp.stage;
                newActivities.push({
                    id: Date.now().toString() + '_stage',
                    type: 'stage_change',
                    description: `Stage changed from "${oldStageName}" to "${newStageName}"`,
                    timestamp: new Date().toISOString(),
                    userId: currentUser.id,
                    userName: currentUser.name,
                    oldValue: existingOpp.stage,
                    newValue: opp.stage
                });
                activityAdded = true;
            }

            // Track Status Change
            if (opp.status !== undefined && opp.status !== existingOpp.status) {
                newActivities.push({
                    id: Date.now().toString() + '_status',
                    type: 'status_change',
                    description: `Status changed from "${existingOpp.status}" to "${opp.status}"`,
                    timestamp: new Date().toISOString(),
                    userId: currentUser.id,
                    userName: currentUser.name,
                    oldValue: existingOpp.status,
                    newValue: opp.status
                });
                activityAdded = true;
            }

            // Track Follow-up update
            if (opp.followUpDate !== undefined && opp.followUpDate !== existingOpp.followUpDate) {
                newActivities.push({
                    id: Date.now().toString() + '_followup',
                    type: 'followup_update',
                    description: `Follow-up date set to ${opp.followUpDate}`,
                    timestamp: new Date().toISOString(),
                    userId: currentUser.id,
                    userName: currentUser.name,
                    newValue: opp.followUpDate
                });
                activityAdded = true;
            }

            // Track Task Addition
            if (opp.tasks !== undefined && opp.tasks.length > (existingOpp.tasks?.length || 0)) {
                const newTasksAdded = opp.tasks.filter(nt => !existingOpp.tasks?.some(et => et.id === nt.id));
                newTasksAdded.forEach(nt => {
                    newActivities.push({
                        id: Date.now().toString() + '_task_' + nt.id,
                        type: 'task_added',
                        description: `Task added: "${nt.title}"`,
                        timestamp: new Date().toISOString(),
                        userId: currentUser.id,
                        userName: currentUser.name
                    });
                });
                activityAdded = true;
            }

            // Track Note Addition
            if (opp.notes !== undefined && opp.notes.length > (existingOpp.notes?.length || 0)) {
                const newNotesAdded = opp.notes.filter(nn => !existingOpp.notes?.some(en => en.id === nn.id));
                newNotesAdded.forEach(nn => {
                    newActivities.push({
                        id: Date.now().toString() + '_note_' + nn.id,
                        type: 'note_added',
                        description: `Note added: "${nn.content.substring(0, 30)}${nn.content.length > 30 ? '...' : ''}"`,
                        timestamp: new Date().toISOString(),
                        userId: currentUser.id,
                        userName: currentUser.name
                    });
                });
                activityAdded = true;
            }

            if (activityAdded) {
                opp.activities = newActivities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            }
        }
        // --- End Tracking ---

        await api.opportunities.update(id, opp);
        set((state) => ({
            opportunities: state.opportunities.map((o) => (o.id === id ? { ...o, ...opp } : o)),
        }));
        // Refresh stage counts if stage or value might have changed
        if (opp.stage !== undefined || opp.value !== undefined) {
            get().fetchStageCounts();
        }
    },
    deleteOpportunity: async (id) => {
        const opp = get().opportunities.find((o) => o.id === id);
        const previousOpps = get().opportunities;
        const previousContacts = get().contacts;

        // Optimistic UI Update
        set((state) => ({
            opportunities: state.opportunities.filter((o) => o.id !== id),
            contacts: opp?.contactId ? state.contacts.filter((c) => c.id !== opp.contactId) : state.contacts
        }));

        try {
            const promises = [];
            if (opp?.contactId) {
                promises.push(api.contacts.delete(opp.contactId).catch(err => console.warn("Contact already deleted or failed:", err)));
            }
            promises.push(api.opportunities.delete(id));
            await Promise.all(promises);
            // Refresh stage counts after deletion
            get().fetchStageCounts();
        } catch (error) {
            console.error("Failed to delete opportunity:", error);
            // Revert state if the API call fails
            set({ opportunities: previousOpps, contacts: previousContacts });
            throw error;
        }
    },
    bulkDeleteOpportunities: async (ids: string[]) => {
        const opps = get().opportunities.filter((o) => ids.includes(o.id));
        const contactIds = opps.map((o) => o.contactId).filter((id): id is string => !!id);

        const previousOpps = get().opportunities;
        const previousContacts = get().contacts;

        // Optimistic UI Update
        set((state) => ({
            opportunities: state.opportunities.filter((o) => !ids.includes(o.id)),
            contacts: contactIds.length > 0 ? state.contacts.filter((c) => !contactIds.includes(c.id)) : state.contacts
        }));

        try {
            const promises = [];
            if (contactIds.length > 0) {
                promises.push(api.contacts.bulkDelete(contactIds).catch(err => console.warn("Contacts bulk delete failed:", err)));
            }
            promises.push(api.opportunities.bulkDelete(ids));
            await Promise.all(promises);
            // Refresh stage counts after bulk deletion
            get().fetchStageCounts();
        } catch (error) {
            console.error("Failed to bulk delete opportunities:", error);
            set({ opportunities: previousOpps, contacts: previousContacts });
            throw error;
        }
    },

    fetchAppointments: async () => {
        const userId = get().currentUser?.id;
        if (!userId) {
            set({ appointments: [] });
            return;
        }
        const appointments = await api.appointments.getAll(userId);
        set({ appointments });
    },
    addAppointment: async (apt) => {
        const newApt = await api.appointments.create(apt);
        set((state) => {
            if (state.appointments.some(a => a.id === newApt.id)) {
                return { appointments: state.appointments };
            }
            return { appointments: [...state.appointments, newApt] };
        });
    },
    updateAppointment: async (id, apt) => {
        await api.appointments.update(id, apt);
        set((state) => ({
            appointments: state.appointments.map((a) => (a.id === id ? { ...a, ...apt } : a)),
        }));
    },
    deleteAppointment: async (id) => {
        await api.appointments.delete(id);
        set((state) => ({
            appointments: state.appointments.filter((a) => a.id !== id),
        }));
    },

    // Conversations
    setActiveConversation: (id) => set({ activeConversationId: id }),
    createConversation: async (contactId, contactName) => {
        const userId = get().currentUser?.id;
        if (!userId) return;

        // Check if conversation already exists
        const existing = get().conversations.find(c => c.contactId === contactId);
        if (existing) {
            set({ activeConversationId: existing.id });
            return;
        }

        const newConv = await api.conversations.create({
            contactId,
            contactName,
            lastMessage: '',
            time: new Date().toISOString(),
            unread: false,
            messages: [],
            owner: userId
        });

        set(state => ({
            conversations: [newConv, ...state.conversations],
            activeConversationId: newConv.id
        }));
    },

    fetchConversations: async () => {
        const userId = get().currentUser?.id;
        const conversations = await api.conversations.getAll(userId);
        set({ conversations });
    },

    sendMessage: async (conversationId, text) => {
        const userId = get().currentUser?.id;
        if (!userId) return;

        const message: Message = {
            id: Date.now().toString(),
            sender: 'me',
            message: text,
            timestamp: new Date().toISOString()
        };

        await api.conversations.sendMessage(conversationId, message);
    },

    fetchNotifications: async () => {
        // Mock notifications for now
        set({ notifications: [] });
    },

    loginLogs: [],
    fetchLoginLogs: async () => {
        const logs = await api.logs.getAll();
        set({ loginLogs: logs });
    },

    salesAssets: null,
    fetchSalesAssets: async () => {
        try {
            const assets = await api.settings.getSalesAssets();
            set({ salesAssets: assets as any });
        } catch (error) {
            console.error('Failed to fetch sales assets:', error);
        }
    },
    updateSalesAssets: async (data) => {
        await api.settings.updateSalesAssets(data);
        set({ salesAssets: { ...data } });
    },
    sendSalesAssets: async (opportunityId) => {
        await api.actions.sendSalesAssets(opportunityId);
    },

    fetchDiscoveryResponses: async (phone) => {
        if (!phone) {
            set({ discoveryResponses: [] });
            return;
        }
        set({ isLoading: true });
        try {
            const responses = await api.discovery.getResponses(phone);
            set({ discoveryResponses: responses, isLoading: false });
        } catch (error) {
            console.error('Failed to fetch discovery responses:', error);
            set({ discoveryResponses: [], isLoading: false });
        }
    },

    initializeListeners: () => {
        const userId = get().currentUser?.id;
        if (!userId) return;

        // Fetch initial data
        get().fetchContacts();
        get().fetchOpportunities();
        get().fetchAppointments();
        get().fetchConversations();
        get().fetchNotifications();
        get().fetchSalesAssets();

        // Fetch initial stages once to avoid race conditions in pages
        api.pipelines.get().then(data => {
            if (data && data.length > 0) {
                // Auto-migrate: inject "Not Answering" stage (16.5) if missing
                const hasNotAnswering = data.some((s: any) => s.id === '16.5');
                if (!hasNotAnswering) {
                    const yetToContactIdx = data.findIndex((s: any) => s.id === '16');
                    const insertAt = yetToContactIdx >= 0 ? yetToContactIdx + 1 : 1;
                    data.splice(insertAt, 0, { id: '16.5', title: '16.5 - Not Answering', color: '#eb7311' });
                    // Persist back to Firebase
                    api.pipelines.update(data).catch(console.error);
                }
                set({ stages: data });
            } else {
                // No pipeline in DB yet — use DEFAULT_STAGES and seed it
                const { DEFAULT_STAGES } = require('../lib/demoData');
                set({ stages: DEFAULT_STAGES });
                api.pipelines.update(DEFAULT_STAGES).catch(console.error);
            }
        });

        // Subscribe to real-time updates
        // Note: We are using fetch instead of subscribe for heavy filtered lists to avoid excessive reads/complexity
        // but if we were to subscribe, we MUST pass userId.

        const unsubscribeApps = api.appointments.subscribe((data) => {
            set({ appointments: data });
        }, userId);

        const unsubConvs = api.conversations.subscribe((data) => {
            set({ conversations: data });
        }, userId);

        const unsubStages = api.pipelines.subscribe((data) => {
            if (data && data.length > 0) {
                set({ stages: data });
            }
        });

        // ✅ Real-time opportunities listener — ensures WhatsApp leads appear instantly
        // NOTE: Use the server snapshot as the authoritative source so deletions propagate correctly.
        // Merging (additive-only) was causing deleted items to reappear after deletion.
        const unsubOpps = api.opportunities.subscribe((data) => {
            set({ opportunities: data });
        });

        // Store unsubscribe functions if needed for cleanup
        return () => {
            unsubscribeApps();
            unsubConvs();
            unsubStages();
            unsubOpps();
        };
    }
}));
