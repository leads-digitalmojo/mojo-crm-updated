import { Contact, Opportunity, Appointment, Conversation, Message, Task, Note } from '../types';

// Demo mode detection
export const isDemoMode = (): boolean => {
  // Check URL parameter
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === 'true') return true;
    // Check localStorage
    if (localStorage.getItem('demo_mode') === 'true') return true;
  }
  return false;
};


// Generate realistic dummy data
const companyNames = [
  'TechCorp Solutions', 'Digital Innovations', 'Global Enterprises', 'Smart Systems Inc',
  'Future Dynamics', 'Cloud Services Ltd', 'Data Analytics Pro', 'Creative Agency',
  'Marketing Masters', 'Business Solutions', 'Innovation Hub', 'Tech Startups Co',
  'Enterprise Partners', 'Digital Marketing Pro', 'Growth Ventures', 'Success Corp'
];

const firstNames = [
  'Raj', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Anjali', 'Rahul', 'Kavita',
  'Arjun', 'Meera', 'Siddharth', 'Neha', 'Karan', 'Divya', 'Rohan', 'Pooja'
];

const lastNames = [
  'Sharma', 'Patel', 'Kumar', 'Singh', 'Gupta', 'Verma', 'Reddy', 'Mehta',
  'Jain', 'Shah', 'Agarwal', 'Malhotra', 'Chopra', 'Kapoor', 'Bansal', 'Goyal'
];

const emailDomains = [
  'gmail.com', 'yahoo.com', 'outlook.com', 'company.com', 'business.in', 'enterprise.com'
];

const phonePrefixes = ['+91', '+1', '+44'];

const opportunityNames = [
  'Website Redesign Project', 'Digital Marketing Campaign', 'Mobile App Development',
  'SEO Optimization Service', 'Brand Identity Package', 'E-commerce Platform',
  'Content Marketing Strategy', 'Social Media Management', 'Cloud Migration',
  'Data Analytics Dashboard', 'CRM Implementation', 'Email Marketing Campaign',
  'Video Production Package', 'UI/UX Design Service', 'Lead Generation Program'
];

const stages = ['16', '16.5', '17', '18', '19', '20', '20.5', '21', '10', '0', '0.5', 'not responding'];

const statuses: ('Open' | 'Won' | 'Lost' | 'Abandoned' | 'Not Answered')[] = ['Open', 'Won', 'Lost', 'Open', 'Open', 'Not Answered'];

const tags = ['Hot Lead', 'VIP', 'Follow Up', 'New Client', 'Renewal', 'Enterprise', 'SMB'];

export const DEFAULT_STAGES = [
  { id: '16', title: '16 - Yet to contact', color: '#f0bc00' },
  { id: '16.5', title: '16.5 - Not Answering', color: '#eb7311' },
  { id: '21', title: '21 - Cheque Ready', color: '#1ea34f' },
  { id: '20.5', title: '20.5 - Negotiations', color: '#06aed7' },
  { id: '20', title: '20 - Hot', color: '#eb7311' },
  { id: '19', title: '19 - Warm', color: '#eb7311' },
  { id: '18', title: '18 - Luke Warm', color: '#eb7311' },
  { id: '17', title: '17 - Follow Later', color: '#754c9b' },
  { id: '10', title: '10 - Closed', color: '#1ea34f' },
  { id: '0', title: '0 - Junk', color: '#808080' },
  { id: '0.5', title: '0.5 - No Budget', color: '#808080' },
  { id: 'not responding', title: 'Not Responding', color: '#9f1239' },
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(daysAgo: number = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(randomInt(9, 17), randomInt(0, 59), 0, 0);
  return date.toISOString();
}

export function generateId(): string {
  return `demo_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export const generateDemoContacts = (count: number = 25): Contact[] => {
  const contacts: Contact[] = [];
  for (let i = 0; i < count; i++) {
    const firstName = randomItem(firstNames);
    const lastName = randomItem(lastNames);
    const name = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${randomItem(emailDomains)}`;
    const phone = `${randomItem(phonePrefixes)} ${randomInt(9000000000, 9999999999)}`;
    const company = randomItem(companyNames);

    contacts.push({
      id: generateId(),
      name,
      email,
      phone,
      companyName: company,
      Value: randomItem(['Standard', 'Mid', 'High']),
      owner: 'demo_user',
      type: randomItem(['Branding', 'Performance', 'Creative', '360', '']),
      status: 'Active',
      notes: `Demo contact for ${company}`,
      createdAt: randomDate(randomInt(0, 90))
    });
  }
  return contacts;
};

export const generateDemoOpportunities = (contacts: Contact[], count: number = 30): Opportunity[] => {
  const opportunities: Opportunity[] = [];
  for (let i = 0; i < count; i++) {
    const contact = randomItem(contacts);
    const name = randomItem(opportunityNames);
    const stage = randomItem(stages);
    const status = randomItem(statuses);
    const value = randomInt(50000, 5000000);
    const createdAt = randomDate(randomInt(0, 90));

    // Generate some tasks
    const taskCount = randomInt(0, 5);
    const tasks: Task[] = [];
    for (let j = 0; j < taskCount; j++) {
      tasks.push({
        id: generateId(),
        title: `Task ${j + 1} for ${name}`,
        description: `Demo task description`,
        isCompleted: Math.random() > 0.4,
        dueDate: randomDate(randomInt(0, 30)),
        assignee: 'demo_user',
        createdBy: 'demo_user'
      });
    }

    // Generate some notes
    const noteCount = randomInt(0, 3);
    const notes: Note[] = [];
    for (let j = 0; j < noteCount; j++) {
      notes.push({
        id: generateId(),
        content: `Demo note ${j + 1}: Important update about ${name}`,
        createdAt: randomDate(randomInt(0, 30))
      });
    }

    opportunities.push({
      id: generateId(),
      name,
      value,
      stage,
      status,
      owner: 'demo_user',
      tags: [randomItem(tags), randomItem(tags)].filter((v, i, a) => a.indexOf(v) === i),
      contactId: contact.id,
      contactName: contact.name,
      contactEmail: contact.email,
      contactPhone: contact.phone,
      companyName: contact.companyName,
      source: randomItem(['Website', 'Referral', 'Social Media', 'Cold Call', 'Email']),
      createdAt,
      updatedAt: randomDate(randomInt(0, 7)),
      tasks: tasks.length > 0 ? tasks : undefined,
      notes: notes.length > 0 ? notes : undefined,
      followUpDate: Math.random() > 0.5 ? randomDate(randomInt(1, 14)) : undefined
    });
  }
  return opportunities;
};

export const generateDemoAppointments = (contacts: Contact[], count: number = 15): Appointment[] => {
  const appointments: Appointment[] = [];
  const titles = [
    'Client Meeting', 'Product Demo', 'Follow-up Call', 'Strategy Session',
    'Proposal Presentation', 'Contract Review', 'Onboarding Call', 'Q&A Session'
  ];

  for (let i = 0; i < count; i++) {
    const contact = randomItem(contacts);
    const date = new Date();
    date.setDate(date.getDate() + randomInt(-7, 30));
    const hour = randomInt(9, 17);
    const minute = randomInt(0, 1) * 30; // 0 or 30

    appointments.push({
      id: generateId(),
      title: randomItem(titles),
      date: date.toISOString().split('T')[0],
      time: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
      assignedTo: 'demo_user',
      notes: `Meeting with ${contact.name} from ${contact.companyName}`,
      contactId: contact.id
    });
  }
  return appointments;
};

export const generateDemoConversations = (contacts: Contact[], count: number = 10): Conversation[] => {
  const conversations: Conversation[] = [];
  const messages: Message[] = [
    { id: '1', sender: 'them', message: 'Hello, I\'m interested in your services', timestamp: randomDate(randomInt(1, 7)) },
    { id: '2', sender: 'me', message: 'Hi! I\'d be happy to help. What are you looking for?', timestamp: randomDate(randomInt(0, 6)) },
    { id: '3', sender: 'them', message: 'We need help with digital marketing', timestamp: randomDate(randomInt(0, 5)) },
    { id: '4', sender: 'me', message: 'Great! Let me send you some information.', timestamp: randomDate(randomInt(0, 4)) }
  ];

  for (let i = 0; i < count; i++) {
    const contact = randomItem(contacts);
    const convMessages = messages.slice(0, randomInt(2, 4));

    conversations.push({
      id: generateId(),
      contactId: contact.id,
      contactName: contact.name,
      lastMessage: convMessages[convMessages.length - 1].message,
      time: 'Just now',
      unread: Math.random() > 0.7,
      messages: convMessages,
      owner: 'demo_user'
    });
  }
  return conversations;
};

// Initialize demo data in localStorage
export const initializeDemoData = (): void => {
  if (!isDemoMode()) return;

  // Check if demo data already exists
  if (localStorage.getItem('demo_data_initialized') === 'true') return;

  // Generate demo data
  const contacts = generateDemoContacts(25);
  const opportunities = generateDemoOpportunities(contacts, 30);
  const appointments = generateDemoAppointments(contacts, 15);
  const conversations = generateDemoConversations(contacts, 10);

  // Store in localStorage
  localStorage.setItem('demo_contacts', JSON.stringify(contacts));
  localStorage.setItem('demo_opportunities', JSON.stringify(opportunities));
  localStorage.setItem('demo_appointments', JSON.stringify(appointments));
  localStorage.setItem('demo_conversations', JSON.stringify(conversations));
  localStorage.setItem('demo_pipeline', JSON.stringify(DEFAULT_STAGES));
  localStorage.setItem('demo_data_initialized', 'true');

  console.log('Demo data initialized');
};

// Clear demo data
export const clearDemoData = (): void => {
  localStorage.removeItem('demo_contacts');
  localStorage.removeItem('demo_opportunities');
  localStorage.removeItem('demo_appointments');
  localStorage.removeItem('demo_conversations');
  localStorage.removeItem('demo_data_initialized');
};

