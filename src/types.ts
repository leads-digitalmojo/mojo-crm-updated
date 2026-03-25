export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  Value: 'Standard' | 'Mid' | 'High';
  owner: string;
  companyName?: string;
  type?: 'Branding' | 'Performance' | 'Creative' | '360' | '';
  status?: string;
  notes?: string;
  createdAt?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  isCompleted: boolean;
  dueDate?: string;
  dueTime?: string;
  isRecurring?: boolean;
  assignee?: string;
  assignedBy?: string; // Email or ID of the user who assigned this task
  createdBy?: string; // Email or ID of the user who created this task (for permissions)
}

export interface Note {
  id: string;
  content: string;
  createdAt: string;
}

export interface OpportunityActivity {
  id: string;
  type: 'stage_change' | 'status_change' | 'note_added' | 'task_added' | 'task_completed' | 'assignment_change' | 'followup_update';
  description: string;
  timestamp: string;
  userId: string;
  userName: string;
  oldValue?: string;
  newValue?: string;
}

export interface Opportunity {
  id: string;
  name: string;
  value: number;
  stage: string;
  status: 'Open' | 'Won' | 'Lost' | 'Abandoned' | 'Not Answered';
  owner?: string;
  tags: string[];
  contactId?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  companyName?: string;
  source?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  your_website?: string;
  budget?: string;
  calendar?: string;
  createdAt?: string;
  updatedAt?: string;
  tasks?: Task[];
  notes?: Note[];
  followUpDate?: string;
  followUpRead?: boolean;
  opportunityType?: 'Real Estate' | 'Others';
  followUpAssignee?: string;
  activities?: OpportunityActivity[];
}

export interface PipelineColumn {
  id: string;
  title: string;
  color: string;
  totalValue: number;
  items: Opportunity[];
}

export interface Message {
  id: string;
  sender: 'me' | 'them';
  recipient?: string;
  message: string;
  timestamp: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
}

export interface Conversation {
  id: string;
  contactId: string;
  contactName: string;
  lastMessage: string;
  time: string;
  unread: boolean;
  messages: Message[];
  owner?: string;
}

export interface Appointment {
  id: string;
  title: string;
  time: string;
  date: string; // ISO date string
  assignedTo: string;
  notes: string;
  contactId?: string;
  googleEventId?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  color: string;
  description: string;
  contact: string;
}

export interface LoginLog {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  timestamp: string;
  ip: string;
  city?: string;
  region?: string;
  country?: string;
  loc?: string; // Lat, Long
  org?: string; // ISP
  userAgent: string;
  locationPermission: 'granted' | 'denied' | 'prompt';
}
