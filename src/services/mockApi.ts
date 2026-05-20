import { Contact, Opportunity, Appointment, Conversation, Message, LoginLog } from '../types';
import {
  generateDemoContacts,
  generateDemoOpportunities,
  generateDemoAppointments,
  generateDemoConversations,
  initializeDemoData,
  generateId,
  isDemoMode
} from '../lib/demoData';

// Initialize demo data on first load (only if in demo mode)
if (typeof window !== 'undefined' && isDemoMode()) {
  initializeDemoData();
}

// Helper to get data from localStorage
const getStoredData = <T>(key: string, defaultValue: T[]): T[] => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
};

// Helper to save data to localStorage
const saveStoredData = <T>(key: string, data: T[]): void => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error('Error saving to localStorage:', error);
  }
};

// Simulate network delay
const delay = (ms: number = 100) => new Promise(resolve => setTimeout(resolve, ms));

export const mockApi = {
  contacts: {
    getAll: async (userId?: string, lastDoc?: any, limitCount: number = 20) => {
      await delay(300);
      const contacts = getStoredData<Contact>('demo_contacts', []);
      // Simple pagination simulation
      const startIndex = lastDoc ? parseInt(lastDoc) || 0 : 0;
      const endIndex = startIndex + limitCount;
      const data = contacts.slice(startIndex, endIndex);
      return {
        data,
        lastDoc: endIndex < contacts.length ? endIndex.toString() : null
      };
    },
    get: async (id: string) => {
      await delay(200);
      const contacts = getStoredData<Contact>('demo_contacts', []);
      return contacts.find(c => c.id === id) || null;
    },
    search: async (userId: string | undefined, term: string) => {
      await delay(300);
      const contacts = getStoredData<Contact>('demo_contacts', []);
      const searchTermLower = term.toLowerCase().trim();
      return contacts.filter(contact => {
        const nameMatch = contact.name?.toLowerCase().includes(searchTermLower);
        const emailMatch = contact.email?.toLowerCase().includes(searchTermLower);
        const phoneMatch = contact.phone?.toLowerCase().includes(searchTermLower);
        const companyMatch = contact.companyName?.toLowerCase().includes(searchTermLower);
        return nameMatch || emailMatch || phoneMatch || companyMatch;
      });
    },
    subscribe: (callback: (data: Contact[]) => void, userId?: string) => {
      const contacts = getStoredData<Contact>('demo_contacts', []);
      callback(contacts);
      // Return a no-op unsubscribe function
      return () => { };
    },
    create: async (contact: Omit<Contact, 'id'>) => {
      await delay(300);
      const contacts = getStoredData<Contact>('demo_contacts', []);
      const newContact: Contact = {
        id: generateId(),
        ...contact,
        createdAt: new Date().toISOString()
      };
      contacts.unshift(newContact);
      saveStoredData('demo_contacts', contacts);
      return newContact;
    },
    update: async (id: string, contact: Partial<Contact>) => {
      await delay(300);
      const contacts = getStoredData<Contact>('demo_contacts', []);
      const index = contacts.findIndex(c => c.id === id);
      if (index !== -1) {
        contacts[index] = { ...contacts[index], ...contact };
        saveStoredData('demo_contacts', contacts);
      }
    },
    delete: async (id: string) => {
      await delay(300);
      const contacts = getStoredData<Contact>('demo_contacts', []);
      const filtered = contacts.filter(c => c.id !== id);
      saveStoredData('demo_contacts', filtered);
    },
    bulkDelete: async (ids: string[]) => {
      await delay(300);
      const contacts = getStoredData<Contact>('demo_contacts', []);
      const filtered = contacts.filter(c => !ids.includes(c.id));
      saveStoredData('demo_contacts', filtered);
    },
    bulkAddTags: async (ids: string[], tags: string[]) => {
      await delay(300);
      const contacts = getStoredData<Contact>('demo_contacts', []);
      contacts.forEach(contact => {
        if (ids.includes(contact.id)) {
          const existingTags = (contact as any).tags || [];
          (contact as any).tags = Array.from(new Set([...existingTags, ...tags]));
        }
      });
      saveStoredData('demo_contacts', contacts);
    },
    removeDuplicates: async () => {
      await delay(500);
      const contacts = getStoredData<Contact>('demo_contacts', []);
      const seen = new Map<string, string>();
      const duplicateIds: string[] = [];

      contacts.forEach(contact => {
        const email = (contact.email || '').toLowerCase().trim();
        const name = (contact.name || '').toLowerCase().trim();
        const key = email || name;

        if (key && seen.has(key)) {
          duplicateIds.push(contact.id);
        } else if (key) {
          seen.set(key, contact.id);
        }
      });

      if (duplicateIds.length > 0) {
        const filtered = contacts.filter(c => !duplicateIds.includes(c.id));
        saveStoredData('demo_contacts', filtered);
      }

      return { removed: duplicateIds.length, kept: seen.size };
    }
  },
  opportunities: {
    getAll: async (userId?: string, lastDoc?: any, limitCount: number = 20) => {
      await delay(300);
      const opportunities = getStoredData<Opportunity>('demo_opportunities', []);
      const startIndex = lastDoc ? parseInt(lastDoc) || 0 : 0;
      const endIndex = startIndex + limitCount;
      const data = opportunities.slice(startIndex, endIndex);
      return {
        data,
        lastDoc: endIndex < opportunities.length ? endIndex.toString() : null
      };
    },
    getByStage: async (stageId: string, lastDoc?: any, limitCount: number = 10) => {
      await delay(300);
      const opportunities = getStoredData<Opportunity>('demo_opportunities', []);
      const filtered = opportunities.filter(o => o.stage === stageId);
      const startIndex = lastDoc ? parseInt(lastDoc) || 0 : 0;
      const endIndex = startIndex + limitCount;
      const data = filtered.slice(startIndex, endIndex);
      return {
        data,
        lastDoc: endIndex < filtered.length ? endIndex.toString() : null,
        hasMore: endIndex < filtered.length
      };
    },
    getByFollowUpDate: async (followUpDate: string) => {
      await delay(200);
      const opportunities = getStoredData<Opportunity>('demo_opportunities', []);
      return opportunities.filter(o => o.followUpDate === followUpDate);
    },
    subscribe: (callback: (data: Opportunity[]) => void, userId?: string) => {
      const opportunities = getStoredData<Opportunity>('demo_opportunities', []);
      callback(opportunities);
      return () => { };
    },
    create: async (opp: Omit<Opportunity, 'id'>) => {
      await delay(300);
      const opportunities = getStoredData<Opportunity>('demo_opportunities', []);
      const newOpp: Opportunity = {
        id: generateId(),
        ...opp,
        createdAt: new Date().toISOString()
      };
      opportunities.push(newOpp);
      saveStoredData('demo_opportunities', opportunities);
      return newOpp;
    },
    update: async (id: string, opp: Partial<Opportunity>) => {
      await delay(300);
      const opportunities = getStoredData<Opportunity>('demo_opportunities', []);
      const index = opportunities.findIndex(o => o.id === id);
      if (index !== -1) {
        opportunities[index] = { ...opportunities[index], ...opp };
        saveStoredData('demo_opportunities', opportunities);
      }
    },
    delete: async (id: string) => {
      await delay(300);
      const opportunities = getStoredData<Opportunity>('demo_opportunities', []);
      const filtered = opportunities.filter(o => o.id !== id);
      saveStoredData('demo_opportunities', filtered);
    },
    bulkDelete: async (ids: string[]) => {
      await delay(300);
      const opportunities = getStoredData<Opportunity>('demo_opportunities', []);
      const filtered = opportunities.filter(o => !ids.includes(o.id));
      saveStoredData('demo_opportunities', filtered);
    },
    getStageCounts: async () => {
      await delay(200);
      const opportunities = getStoredData<Opportunity>('demo_opportunities', []);
      const counts: Record<string, { count: number; value: number }> = {};

      opportunities.forEach(opp => {
        const stage = opp.stage || 'Unknown';
        const value = Number(opp.value) || 0;

        if (!counts[stage]) {
          counts[stage] = { count: 0, value: 0 };
        }
        counts[stage].count += 1;
        counts[stage].value += value;
      });

      return counts;
    },
    getDashboardStats: async (daysBack: number = 30) => {
      await delay(400);
      const opportunities = getStoredData<Opportunity>('demo_opportunities', []);

      const now = new Date();
      now.setHours(23, 59, 59, 999);
      const pastDate = new Date();
      pastDate.setDate(now.getDate() - (daysBack - 1));
      pastDate.setHours(0, 0, 0, 0);

      const filteredOpportunities = opportunities.filter(opp => {
        if (!opp.createdAt) return false;
        try {
          const oppDate = new Date(opp.createdAt);
          if (isNaN(oppDate.getTime())) return false;
          return oppDate >= pastDate && oppDate <= now;
        } catch {
          return false;
        }
      });

      const totalOpportunities = filteredOpportunities.length;
      const totalPipelineValue = filteredOpportunities.reduce((sum, opp) => sum + Number(opp.value || 0), 0);
      const wonOpportunities = filteredOpportunities.filter(opp => opp.status === 'Won' || opp.stage === '10').length;
      const lostOpportunities = filteredOpportunities.filter(opp => opp.status === 'Lost').length;
      const openOpportunities = filteredOpportunities.filter(opp => opp.status === 'Open' || opp.status === 'Not Answered').length;
      const conversionRate = totalOpportunities > 0 ? ((wonOpportunities / totalOpportunities) * 100) : 0;

      // Stage breakdown - filtered by time range so chart responds to duration selector
      const stageBreakdown: Record<string, { count: number; value: number }> = {};
      filteredOpportunities.forEach(opp => {
        const stage = opp.stage || 'Unknown';
        if (!stageBreakdown[stage]) {
          stageBreakdown[stage] = { count: 0, value: 0 };
        }
        stageBreakdown[stage].count += 1;
        stageBreakdown[stage].value += Number(opp.value || 0);
      });

      const sortedOpps = [...filteredOpportunities].sort((a, b) =>
        new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
      );

      let cumulativeValue = 0;
      const trendMap = new Map<string, number>();
      sortedOpps.forEach(opp => {
        if (opp.createdAt) {
          const date = new Date(opp.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          cumulativeValue += Number(opp.value || 0);
          trendMap.set(date, cumulativeValue);
        }
      });
      const pipelineTrend = Array.from(trendMap.entries()).map(([name, value]) => ({ name, value }));

      const allTasks = filteredOpportunities.flatMap(o => o.tasks || []);
      const completedTasks = allTasks.filter(t => t.isCompleted).length;
      const pendingTasks = allTasks.length - completedTasks;

      return {
        totalOpportunities,
        totalPipelineValue,
        wonOpportunities,
        lostOpportunities,
        openOpportunities,
        conversionRate,
        stageBreakdown,
        pipelineTrend,
        taskStats: {
          completed: completedTasks,
          pending: pendingTasks,
          total: allTasks.length
        },
        allOpportunities: filteredOpportunities
      };
    },
    removeDuplicates: async () => {
      await delay(500);
      const opportunities = getStoredData<Opportunity>('demo_opportunities', []);
      const seen = new Map<string, string>();
      const duplicateIds: string[] = [];

      opportunities.forEach(opp => {
        const name = (opp.name || '').toLowerCase().trim();
        const contactId = opp.contactId || '';
        const key = `${name}_${contactId}`;

        if (name && seen.has(key)) {
          duplicateIds.push(opp.id);
        } else if (name) {
          seen.set(key, opp.id);
        }
      });

      if (duplicateIds.length > 0) {
        const filtered = opportunities.filter(o => !duplicateIds.includes(o.id));
        saveStoredData('demo_opportunities', filtered);
      }

      return { removed: duplicateIds.length, kept: seen.size };
    },
    cleanupLegacySources: async (cutoffDate: string) => {
      await delay(500);
      const opportunities = getStoredData<Opportunity>('demo_opportunities', []);

      const updatedOpps = opportunities.map(opp => {
        if (opp.createdAt && opp.createdAt < cutoffDate && opp.source !== '') {
          return { ...opp, source: '' };
        }
        return opp;
      });

      const updatedCount = opportunities.filter(opp =>
        opp.createdAt && opp.createdAt < cutoffDate && opp.source !== ''
      ).length;

      if (updatedCount > 0) {
        saveStoredData('demo_opportunities', updatedOpps);
      }

      return { updated: updatedCount };
    }
  },
  appointments: {
    getAll: async (userId?: string) => {
      await delay(300);
      const appointments = getStoredData<Appointment>('demo_appointments', []);
      if (userId) {
        return appointments.filter(a => a.assignedTo === userId);
      }
      return appointments;
    },
    subscribe: (callback: (data: Appointment[]) => void, userId?: string) => {
      const appointments = getStoredData<Appointment>('demo_appointments', []);
      const filtered = userId ? appointments.filter(a => a.assignedTo === userId) : appointments;
      callback(filtered);
      return () => { };
    },
    create: async (apt: Omit<Appointment, 'id'>) => {
      await delay(300);
      const appointments = getStoredData<Appointment>('demo_appointments', []);
      const newApt: Appointment = {
        id: generateId(),
        ...apt
      };
      appointments.push(newApt);
      saveStoredData('demo_appointments', appointments);
      return newApt;
    },
    update: async (id: string, apt: Partial<Appointment>) => {
      await delay(300);
      const appointments = getStoredData<Appointment>('demo_appointments', []);
      const index = appointments.findIndex(a => a.id === id);
      if (index !== -1) {
        appointments[index] = { ...appointments[index], ...apt };
        saveStoredData('demo_appointments', appointments);
      }
    },
    delete: async (id: string) => {
      await delay(300);
      const appointments = getStoredData<Appointment>('demo_appointments', []);
      const filtered = appointments.filter(a => a.id !== id);
      saveStoredData('demo_appointments', filtered);
    }
  },
  conversations: {
    getAll: async (userId?: string) => {
      await delay(300);
      const conversations = getStoredData<Conversation>('demo_conversations', []);
      return conversations.sort((a, b) =>
        new Date(b.time).getTime() - new Date(a.time).getTime()
      );
    },
    subscribe: (callback: (data: Conversation[]) => void, userId?: string) => {
      const conversations = getStoredData<Conversation>('demo_conversations', []);
      callback(conversations);
      return () => { };
    },
    sendMessage: async (conversationId: string, message: Message) => {
      await delay(300);
      const conversations = getStoredData<Conversation>('demo_conversations', []);
      const index = conversations.findIndex(c => c.id === conversationId);
      if (index !== -1) {
        conversations[index].messages.push(message);
        conversations[index].lastMessage = message.message;
        conversations[index].time = 'Just now';
        saveStoredData('demo_conversations', conversations);
      }
    },
    create: async (conversation: Omit<Conversation, 'id'>) => {
      await delay(300);
      const conversations = getStoredData<Conversation>('demo_conversations', []);
      const newConv: Conversation = {
        id: generateId(),
        ...conversation
      };
      conversations.unshift(newConv);
      saveStoredData('demo_conversations', conversations);
      return newConv;
    }
  },
  notifications: {
    getAll: async () => {
      await delay(200);
      return [];
    }
  },
  users: {
    create: async (userId: string, data: { name: string, email: string, avatar: string }) => {
      await delay(200);
      // Mock implementation - just return success
      return;
    }
  },
  pipelines: {
    get: async () => {
      await delay(200);
      return getStoredData<any>('demo_pipeline', []);
    },
    update: async (stages: any[]) => {
      await delay(300);
      saveStoredData('demo_pipeline', stages);
    },
    subscribe: (callback: (stages: any[]) => void) => {
      const stages = getStoredData<any>('demo_pipeline', []);
      callback(stages);
      return () => { };
    }
  },
  logs: {
    getAll: async (limitCount = 50) => {
      await delay(300);
      return getStoredData<LoginLog>('demo_login_logs', []);
    },
    create: async (log: Omit<LoginLog, 'id'>) => {
      await delay(200);
      const logs = getStoredData<LoginLog>('demo_login_logs', []);
      const newLog: LoginLog = { id: generateId(), ...log };
      logs.unshift(newLog);
      saveStoredData('demo_login_logs', logs.slice(0, 100)); // Keep last 100
      return newLog;
    }
  },
  settings: {
    getSalesAssets: async () => {
      await delay(200);
      const data = localStorage.getItem('demo_sales_assets');
      if (data) return JSON.parse(data);
      return {
        pdf1Url: '',
        pdf2Url: '',
        formUrl: 'https://docs.google.com/forms/d/1oejLDSS_mYJDks3YQVjJSsGmsNc3ofRacpB4dJezYgs/edit'
      };
    },
    updateSalesAssets: async (data: { pdf1Url: string, pdf2Url: string, formUrl: string }) => {
      await delay(300);
      localStorage.setItem('demo_sales_assets', JSON.stringify({ ...data, updatedAt: new Date().toISOString() }));
    }
  },
  actions: {
    sendSalesAssets: async (opportunityId: string) => {
      await delay(1000);
      console.log('Mock: Sending sales assets for', opportunityId);
      return { success: true };
    }
  },
  discovery: {
    getResponses: async (phone: string) => {
      await delay(200);
      const normalized = phone.replace(/\D/g, '').slice(-10);
      
      // If searching for the 5th Element lead or similar in demo mode
      if (normalized === '8904047768') {
        return [{
          id: 'mock_discovery_1',
          phone: normalized,
          submittedAt: new Date().toISOString(),
          responses: {
            'Your Name': 'Shilpa K (Demo)',
            'Brand Name': '5th Element',
            'Business Goal': 'Growth 30-50%',
            'Pain Point': 'Marketing'
          },
          createdAt: new Date().toISOString()
        }];
      }
      return [];
    },
    analyzeResponse: async (id: string, responses: any) => {
      await new Promise(r => setTimeout(r, 1000));
      return {
        strategy: "Focus on Growth 30-50% targets.",
        talkingPoints: ["Market leadership", "ROI"],
        openingScript: "Hello Shilpa, let's talk growth...",
        hotButtons: ["Scale"],
        concerns: ["Budget"]
      };
    }
  }
};

