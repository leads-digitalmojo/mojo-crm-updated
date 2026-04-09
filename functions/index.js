const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const axios = require('axios');

admin.initializeApp();
const db = admin.firestore();

// Wati Configuration from User
const WATI_TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1bmlxdWVfbmFtZSI6ImxlYWRzQGRpZ2l0YWxtb2pvLmluIiwibmFtZWlkIjoibGVhZHNAZGlnaXRhbG1vam8uaW4iLCJlbWFpbCI6ImxlYWRzQGRpZ2l0YWxtb2pvLmluIiwiYXV0aF90aW1lIjoiMDMvMjUvMjAyNiAxMTowMzo0OSIsInRlbmFudF9pZCI6IjEwMjc5NzEiLCJkYl9uYW1lIjoibXQtcHJvZC1UZW5hbnRzIiwiaHR0cDovL3NjaGVtYXMubWljcm9zb2Z0LmNvbS93cy8yMDA4LzA2L2lkZW50aXR5L2NsYWltcy9yb2xlIjoiQURNSU5JU1RSQVRPUiIsImV4cCI6MjUzNDAyMzAwODAwLCJpc3MiOiJDbGFyZV9BSSIsImF1ZCI6IkNsYXJlX0FJIn0.cIBcBq51XwIASupP4x9BLT8vN7-NdJ0cKM-6TDej3CM';
const WATI_ENDPOINT = 'https://live-mt-server.wati.io/1027971';
const ANTHROPIC_API_KEY = functions.config().anthropic?.key || process.env.ANTHROPIC_API_KEY;

// Synchronized User List (from src/lib/admin.ts)
const USERS = [
    { name: 'Dhiraj', email: 'dhiraj@digitalmojo.in', phone: '919908398763', isAdmin: true },
    { name: 'Srishti', email: 'srishti@digitalmojo.in', phone: '919899488155', isAdmin: true },
    { name: 'Rupal', email: 'rupal@digitalmojo.in', phone: '919676670777', isAdmin: false },
    { name: 'Veda', email: 'veda@digitalmojo.in', phone: '919032157788', isAdmin: false },
    { name: 'Komal', email: 'komal@digitalmojo.in', phone: '917981245752', isAdmin: false },
    { name: 'Aditya', email: 'aditya.digitalmojo@gmail.com', phone: '918017699390', isAdmin: true },
];

/**
 * Helper to send a Wati Template Message.
 * This works even if the 24-hour session window is closed.
 */
async function sendWatiTemplate(phone, templateName, parameters) {
    const url = `${WATI_ENDPOINT}/api/v1/sendTemplateMessage?whatsappNumber=${phone}`;
    const payload = {
        template_name: templateName,
        broadcast_name: `CRM_${templateName}_${Date.now()}`,
        parameters: parameters.map((val, index) => ({
            name: (index + 1).toString(),
            value: val || 'N/A'
        }))
    };

    try {
        console.log(`[Wati API] Sending template "${templateName}" to ${phone}...`);
        const response = await axios.post(url, payload, {
            headers: { 'Authorization': WATI_TOKEN }
        });
        return response.data;
    } catch (error) {
        console.error(`[Wati API] Error sending template "${templateName}" to ${phone}:`, error.response?.data || error.message);
        throw error;
    }
}

/**
 * Helper to get the current date in YYYY-MM-DD format (IST)
 */
function getISTDateString() {
    return new Date().toLocaleString("en-US", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).split(',')[0].split('/').reverse().join('-');
    // Converts "MM/DD/YYYY" to "YYYY-MM-DD" via reverse
    // Wait, let's be more robust:
    const d = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Helper to safely notify a team member if they are in the whitelist
 */
async function notifyTeamMember(email, messageData) {
    const user = USERS.find(u => u.email.toLowerCase() === (email || '').toLowerCase());
    if (!user || !user.phone || user.phone === '91xxxxxxxxxx') {
        console.log(`[Notifications] Skipping notification for ${email} (Non-whitelisted or invalid phone)`);
        return false;
    }

    const { type, leadName, project, followUpDate, context } = messageData;

    try {
        if (type === 'deadline') {
            const templateName = 'deadline_reminder_v1';
            const params = [leadName, project || 'General', context || 'Deadline Alert'];
            
            try {
                await sendWatiTemplate(user.phone, templateName, params);
            } catch (e) {
                console.log(`[Notifications] Template failed for ${user.name}, falling back to session message.`);
                const text = `⏰ *Deadline Alert*\n\nLead: ${leadName}\nProject: ${project || 'N/A'}\nFollow-up: ${followUpDate}\n\n${context}`;
                await axios.post(`${WATI_ENDPOINT}/api/v1/sendSessionMessage/${user.phone}?messageText=${encodeURIComponent(text)}`, {}, { headers: { Authorization: WATI_TOKEN } });
            }
        } else if (type === 'assignment') {
            await sendWatiTemplate(user.phone, 'lead_assignment_v1', [leadName, project || 'General', followUpDate || 'Not set']);
        }
        return true;
    } catch (err) {
        console.error(`[Notifications] Failed to notify ${user.name}:`, err.message);
        return false;
    }
}

/**
 * Webhook to receive WhatsApp messages from Wati.
 *
 * This webhook is RESILIENT: it accepts ANY incoming message and creates a lead.
 * If the message follows the "Lead: Name, Phone, Project, Value, Notes" format, it
 * parses those fields. Otherwise, it uses the sender's Wati contact info as a fallback.
 */
exports.whatsappWebhook = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    try {
        const payload = req.body;
        console.log(`[WhatsApp Webhook] RAW PAYLOAD: ${JSON.stringify(payload)}`);

        // 0. Skip outgoing messages
        if (payload.owner === true) {
            return res.status(200).send('Skipped - Outgoing');
        }

        // 1. Extract raw text
        const rawText = (payload.text?.body || payload.text || payload.messageText || payload.caption || payload.data || '').trim();
        if (!rawText) {
            console.log('[WhatsApp Webhook] Ignored - Empty message body');
            return res.status(200).send('Ignored - Empty');
        }

        // 2. Get sender (boss) and Authorization Check
        const senderNumber = (payload.waId || payload.whatsappNumber || payload.from || '').replace(/\D/g, '');
        const authorizedPhones = USERS.map(u => u.phone.replace(/\D/g, ''));
        
        if (!authorizedPhones.includes(senderNumber)) {
            console.log(`[WhatsApp Webhook] 🛑 Unauthorized attempt from: ${senderNumber}`);
            return res.status(200).send('Unauthorized');
        }

        // 3. Send to Claude for Lead Extraction
        console.log(`[WhatsApp Webhook] Calling Claude for extraction...`);
        const anthropicResponse = await axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-3-5-sonnet-20241022', // Updated to latest available Sonnet model
            max_tokens: 512,
            messages: [{
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `You are a lead extraction assistant for a digital marketing CRM. Extract lead info from this WhatsApp message and return ONLY valid JSON with these exact fields:
{ "name": string|null, "phone": string|null, "email": string|null, "budget": string|null, "website": string|null, "requirements": string|null, "country": string|null, "notes": string|null }
Rules:
- phone: digits only, full international format. US: +1(945)4009090 → 19454009090. India: +91 98765 43210 → 919876543210. UK: +44 7911 123456 → 447911123456. Strip all spaces, dashes, brackets, plus signs. If 10 digits with no country code and doesn't start with 0, prepend 91. If starts with 0, drop the 0 and prepend 91.
- name: full name of the lead
- budget: exact string as written e.g. "1 lakh - 5 lakh", "5k-10k USD"
- requirements: service they want e.g. Branding, Performance, Marketing, SEO
- country: 2-letter ISO code based on phone country code or any context in message e.g. IN, US, GB, AE, SG. null if unknown
- notes: anything else that doesn't fit the above fields
- Return null for any field not present
- Return ONLY the JSON object, no explanation, no markdown\n\nMessage: ${rawText}`
                    }
                ]
            }]
        }, {
            headers: {
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json'
            }
        });

        const extractionText = anthropicResponse.data.content[0].text;
        console.log(`[WhatsApp Webhook] Claude Response: ${extractionText}`);
        
        // Match JSON object
        const jsonMatch = extractionText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error('[WhatsApp Webhook] Could not find JSON in Claude response');
            return res.status(200).send('Extraction Failed - No JSON');
        }

        const extracted = JSON.parse(jsonMatch[0]);

        // 4. Validation: Need at least name or phone
        if (!extracted.name && !extracted.phone) {
            console.log('[WhatsApp Webhook] Both name and phone are null. Skipping lead creation.');
            return res.status(200).send('Skipped - Insufficient data');
        }

        // 5. Round-Robin Assignment (Rupal vs Veda)
        const assignmentRef = db.collection('config').doc('assignment');
        const assignmentDoc = await assignmentRef.get();
        let lastAssigned = 'Rupal';
        if (assignmentDoc.exists) {
            lastAssigned = assignmentDoc.data().lastAssigned;
        }

        // Round-robin: if lastAssigned === 'Rupal' assign Veda, else assign Rupal
        const assignedName = lastAssigned === 'Rupal' ? 'Veda' : 'Rupal';
        const assignedTo = (assignedName === 'Rupal') ? 'rupal@digitalmojo.in' : 'veda@digitalmojo.in';
        
        await assignmentRef.set({ lastAssigned: assignedName, updatedAt: new Date().toISOString() }, { merge: true });

        // 6. Build Notes
        const notesArray = [rawText];
        if (extracted.notes) {
            notesArray.push(extracted.notes);
        }

        // 7. Create Opportunity Document
        const displayLeadName = extracted.name || extracted.phone || 'WhatsApp Lead';
        const opportunityData = {
            name: displayLeadName,
            contactName: displayLeadName,
            contactPhone: extracted.phone || '',
            contactEmail: extracted.email || '',
            phone: extracted.phone || '',
            value: 0,
            budget: extracted.budget || '',
            your_website: extracted.website || '',
            country: extracted.country || null,
            source: 'WhatsApp',
            stage: '16',
            status: 'Open',
            owner: assignedTo,
            followUpAssignee: assignedTo,
            tags: extracted.requirements ? [extracted.requirements] : [],
            tasks: [],
            notes: notesArray,
            followUpDate: '',
            followUpRead: false,
            deadlineNotified: false,
            assignmentNotified: false,
            redFlagSent: false,
            welcomeMessageSent: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            activities: [{ 
                id: Date.now().toString(), 
                type: 'status_change', 
                description: `Lead created via WhatsApp from ${senderNumber}`, 
                timestamp: new Date().toISOString(), 
                userName: 'Wati Automation' 
            }]
        };

        const docRef = await db.collection('opportunities').add(opportunityData);
        console.log(`[WhatsApp Webhook] ✅ Created lead ${docRef.id} for ${displayLeadName} (Assigned to: ${assignedName})`);

        // 8. Welcome message disabled — enable after testing
        /*
        try {
            const welcomeText = `Hi ${extracted.name || 'there'}! Welcome to Digital Mojo. We have received your inquiry and ${assignedName} will be in touch shortly.`;
            if (extracted.phone) {
                await axios.post(`${WATI_ENDPOINT}/api/v1/sendSessionMessage/${extracted.phone}?messageText=${encodeURIComponent(welcomeText)}`, {}, { headers: { Authorization: WATI_TOKEN } });
                await docRef.update({ welcomeMessageSent: true });
            }
        } catch (welcomeErr) {
            console.error('[WhatsApp Webhook] Failed to send welcome message:', welcomeErr.message);
        }
        */

        // 9. Send Confirmation to Sender (Boss)
        const nameConfirm = displayLeadName;
        const phoneConfirm = extracted.phone || 'N/A';
        const emailConfirm = extracted.email || 'N/A';
        const budgetConfirm = extracted.budget || 'N/A';
        
        const confirmationText = `✅ Lead created!\nName: ${nameConfirm}\nPhone: ${phoneConfirm}\nEmail: ${emailConfirm}\nBudget: ${budgetConfirm}\nAssigned to: ${assignedName}`;
        
        try {
            await sendWatiTemplate(senderNumber, 'lead_created_confirmation', [
                nameConfirm,
                phoneConfirm,
                `${assignedName} - Auto Assigned`
            ]);
        } catch (e) {
            console.log('[WhatsApp Webhook] Boss confirmation template failed, using session message fallback.');
            await axios.post(`${WATI_ENDPOINT}/api/v1/sendSessionMessage/${senderNumber}?messageText=${encodeURIComponent(confirmationText)}`, {}, { headers: { Authorization: WATI_TOKEN } });
        }

        return res.status(200).json({ success: true, leadId: docRef.id, name: displayLeadName });

    } catch (error) {
        console.error('[WhatsApp Webhook] ERROR:', error.response?.data || error.message);
        return res.status(500).send('Internal Error');
    }
});

/**
 * Scheduled function to check for lead follow-up deadlines and new assignments every 10 minutes
 */
exports.deadlineAlerts = functions.pubsub.schedule('every 10 minutes').onRun(async (context) => {
    const now = new Date();
    // Use a 24-hour sliding window to handle IST/UTC rollovers robustly
    const lookbackWindow = new Date(now.getTime() - (24 * 60 * 60 * 1000));

        console.log(`[Deadline Alerts] Cron starting. Now: ${now.toISOString()}, Lookback: ${lookbackWindow.toISOString()}`);

        const snapshot = await db.collection('opportunities')
            .where('status', '==', 'Open')
            .get();

        const docs = snapshot.docs;
        console.log(`[Deadline Alerts] Found ${docs.length} open leads to check.`);

        for (const doc of docs) {
            const lead = doc.data();
            const leadCreatedAt = lead.createdAt?.toDate ? lead.createdAt.toDate() : new Date(lead.createdAt || 0);
            const today = getISTDateString();

            // Skip leads outside our lookback window for assignments
            // But we keep checking for deadlines regardless of creation date if they are Open
            
            // --- 1. NEW ASSIGNMENT CHECK ---
            if (leadCreatedAt >= lookbackWindow && lead.followUpAssignee && lead.assignmentNotified !== true) {
                const sent = await notifyTeamMember(lead.followUpAssignee, {
                    type: 'assignment',
                    leadName: lead.name,
                    project: lead.project,
                    followUpDate: lead.followUpDate
                });
                if (sent) await doc.ref.update({ assignmentNotified: true });
            }

            // --- 2. REAL-TIME DEADLINE CHECK (10 Min Delay) ---
            // If followUpDate is TODAY and we haven't notified for today yet
            if (lead.followUpDate === today && lead.deadlineNotifiedAt !== today && lead.followUpAssignee) {
                console.log(`[Deadline Alerts] Real-time alert for ${lead.name} (Assignee: ${lead.followUpAssignee})`);
                const sent = await notifyTeamMember(lead.followUpAssignee, {
                    type: 'deadline',
                    leadName: lead.name,
                    project: lead.project,
                    followUpDate: lead.followUpDate,
                    context: 'Follow-up is due today!'
                });
                if (sent) await doc.ref.update({ deadlineNotifiedAt: today });
            }
        }
    return null;
});

/**
 * Scheduled function to send a batch of deadline reminders at 9:00 AM IST daily
 */
exports.notifyDailyDeadlines = functions.pubsub.schedule('0 9 * * *')
    .timeZone('Asia/Kolkata')
    .onRun(async (context) => {
        const today = getISTDateString();
        console.log(`[Daily Deadlines] Running for ${today}`);

        const snapshot = await db.collection('opportunities')
            .where('status', '==', 'Open')
            .where('followUpDate', '==', today)
            .get();

        console.log(`[Daily Deadlines] Found ${snapshot.size} leads with deadlines today.`);

        for (const doc of snapshot.docs) {
            const lead = doc.data();
            
            // Only notify if not already notified today (though 9 AM is usually the first check)
            if (lead.deadlineNotifiedAt !== today && lead.followUpAssignee) {
                const sent = await notifyTeamMember(lead.followUpAssignee, {
                    type: 'deadline',
                    leadName: lead.name,
                    project: lead.project,
                    followUpDate: lead.followUpDate,
                    context: 'Morning Reminder: You have a follow-up scheduled for today.'
                });
                if (sent) await doc.ref.update({ deadlineNotifiedAt: today });
            }
        }

        return null;
    });

