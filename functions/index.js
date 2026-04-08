const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const axios = require('axios');

admin.initializeApp();
const db = admin.firestore();

// Wati Configuration from User
const WATI_TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1bmlxdWVfbmFtZSI6ImxlYWRzQGRpZ2l0YWxtb2pvLmluIiwibmFtZWlkIjoibGVhZHNAZGlnaXRhbG1vam8uaW4iLCJlbWFpbCI6ImxlYWRzQGRpZ2l0YWxtb2pvLmluIiwiYXV0aF90aW1lIjoiMDMvMjUvMjAyNiAxMTowMzo0OSIsInRlbmFudF9pZCI6IjEwMjc5NzEiLCJkYl9uYW1lIjoibXQtcHJvZC1UZW5hbnRzIiwiaHR0cDovL3NjaGVtYXMubWljcm9zb2Z0LmNvbS93cy8yMDA4LzA2L2lkZW50aXR5L2NsYWltcy9yb2xlIjoiQURNSU5JU1RSQVRPUiIsImV4cCI6MjUzNDAyMzAwODAwLCJpc3MiOiJDbGFyZV9BSSIsImF1ZCI6IkNsYXJlX0FJIn0.cIBcBq51XwIASupP4x9BLT8vN7-NdJ0cKM-6TDej3CM';
const WATI_ENDPOINT = 'https://live-mt-server.wati.io/1027971';

// Synchronized User List (from src/lib/admin.ts)
const USERS = [
    { name: 'Dhiraj', email: 'dhiraj@digitalmojo.in', phone: '919908398763', isAdmin: true },
    { name: 'Srishti', email: 'srishti@digitalmojo.in', phone: '919899488155', isAdmin: true },
    { name: 'Rupal', email: 'rupal@digitalmojo.in', phone: '919676670777', isAdmin: false },
    { name: 'Veda', email: 'veda@digitalmojo.in', phone: '919032157788', isAdmin: false },
    { name: 'Komal', email: 'komal@digitalmojo.in', phone: '917981245752', isAdmin: false },
    { name: 'Aditya', email: 'aditya.digitalmojo@gmail.com', phone: '918017699390', isAdmin: false },
];

/**
 * Helper to send a Wati Template Message.
 * This works even if the 24-hour session window is closed.
 */
async function sendWatiTemplate(phone, templateName, parameters) {
    const url = `${WATI_ENDPOINT}/api/v1/sendTemplateMessage/${phone}`;
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
        // Always log the full raw payload for debugging
        console.log(`[WhatsApp Webhook] RAW PAYLOAD: ${JSON.stringify(payload)}`);

        const eventType = payload.eventType || payload.type || '';
        const isOwner = payload.owner === true; // owner=true means the message was SENT by the business (outgoing)
        const statusString = payload.statusString || '';

        // Log the event type for debugging
        console.log(`[WhatsApp Webhook] eventType="${eventType}", owner=${isOwner}, status="${statusString}"`);

        // Skip outgoing messages (sent by your business)
        if (isOwner) {
            console.log('[WhatsApp Webhook] Skipping outgoing message (owner=true)');
            return res.status(200).send('Skipped - Outgoing');
        }

        // Accept: 'message' (Wati standard), 'messageReceived', 'message-received'
        // Skip: empty eventType with status updates like DELIVERED, READ, FAILED, SENT
        const allowedTypes = ['message', 'messagereceived', 'message-received', ''];
        const isStatusUpdate = ['DELIVERED', 'READ', 'FAILED', 'SENT'].includes(statusString) && !payload.text && !payload.data;

        if (!allowedTypes.includes(eventType.toLowerCase()) || isStatusUpdate) {
            console.log(`[WhatsApp Webhook] Ignoring: eventType="${eventType}", statusUpdate=${isStatusUpdate}`);
            return res.status(200).send('Ignored');
        }

        // Extract sender info from multiple possible Wati payload structures
        const senderNumber = payload.waId || payload.whatsappNumber || payload.senderNumber || payload.from || '';
        const senderName = payload.senderName || payload.contactName || payload.name || 'Unknown Contact';

        // Extract message text from multiple possible fields
        const messageText = (
            payload.text?.body ||      // text.body (common Wati structure)
            payload.text ||            // plain text field
            payload.messageText ||     // another common field
            payload.data ||            // fallback
            ''
        ).trim();

        const cleanSender = senderNumber ? senderNumber.replace(/\D/g, '') : '';
        console.log(`[WhatsApp Webhook] Sender: ${cleanSender} (${senderName}), Message: "${messageText}"`);

        if (!cleanSender && !messageText) {
            console.log('[WhatsApp Webhook] No sender or message, skipping.');
            return res.status(200).send('Skipped - No data');
        }

        // --- LEAD PARSING ---
        // Try strict "Lead:" format first: Lead: Name, Phone, Project, Value, Notes
        const leadRegex = /lead[:\s]+\s*(.*?)[,，]\s*(.*?)[,，]\s*(.*?)[,，]\s*(.*?)[,，]\s*(.*)/i;
        const match = messageText.match(leadRegex);

        let leadData;

        if (match) {
            // ✅ Parsed from message format
            const [_, name, phone, project, value, notes] = match;
            leadData = {
                name: name.trim() || senderName,
                phone: phone.trim() || cleanSender,
                project: project.trim() || '',
                value: parseFloat(value.trim().replace(/[^0-9.]/g, '')) || 0,
                notes: [{ id: Date.now().toString(), content: notes.trim(), createdAt: new Date().toISOString() }],
                source: 'WhatsApp (Wati) - Formatted',
                rawMessage: messageText
            };
            console.log(`[WhatsApp Webhook] ✅ Parsed formatted lead: ${name.trim()}`);
        } else {
            // ⚠️ Fallback: create lead from raw contact info
            // This ensures EVERY WhatsApp message creates a lead
            leadData = {
                name: senderName !== 'Unknown Contact' ? senderName : (cleanSender || 'WhatsApp Lead'),
                phone: cleanSender || senderNumber,
                project: '',
                value: 0,
                notes: messageText ? [{ id: Date.now().toString(), content: messageText, createdAt: new Date().toISOString() }] : [],
                source: 'WhatsApp (Wati) - Auto',
                rawMessage: messageText
            };
            console.log(`[WhatsApp Webhook] ⚠️ No "Lead:" format. Creating lead from contact: ${leadData.name}`);
        }

        // Create the opportunity in Firestore
        const docRef = await db.collection('opportunities').add({
            name: leadData.name,
            contactName: leadData.name,
            contactPhone: leadData.phone,
            phone: leadData.phone,
            project: leadData.project,
            value: leadData.value,
            notes: leadData.notes,
            stage: '16', // Yet to contact
            status: 'Open',
            source: leadData.source,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            deadlineNotified: false,
            followUpAssignee: '',
            followUpDate: '',
            followUpRead: false,
            tags: [],
            tasks: [],
            activities: [
                {
                    id: Date.now().toString(),
                    type: 'status_change',
                    description: `Lead created via WhatsApp from ${cleanSender || senderName}`,
                    timestamp: new Date().toISOString(),
                    userName: 'Wati Automation'
                }
            ]
        });

        console.log(`[WhatsApp Webhook] ✅ Lead created: ${docRef.id} for ${leadData.name}`);
        return res.status(200).json({ success: true, leadId: docRef.id, name: leadData.name });

    } catch (error) {
        console.error('[WhatsApp Webhook] ERROR:', error);
        return res.status(500).json({ error: 'Internal Error', message: error.message });
    }
});

/**
 * Scheduled function to check for lead follow-up deadlines and new assignments every 10 minutes
 */
exports.deadlineAlerts = functions.pubsub.schedule('every 10 minutes').onRun(async (context) => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

    console.log(`[Deadline Alerts] Running at ${now.toISOString()} for date ${todayStr}`);

    const snapshot = await db.collection('opportunities')
        .where('status', '==', 'Open')
        .get();

    console.log(`[Deadline Alerts] Scanning ${snapshot.size} open opportunities...`);

    for (const doc of snapshot.docs) {
        const lead = doc.data();
        const updates = {};
        let sendAssignmentMsg = false;
        let sendDeadlineMsg = false;

        // --- 1. NEW ASSIGNMENT CHECK ---
        // If assigned but not notified
        if (lead.followUpAssignee && lead.assignmentNotified !== true) {
            sendAssignmentMsg = true;
        }

        // --- 2. TODAY'S DEADLINE CHECK ---
        // If there's a follow-up date today and not notified for today
        if (lead.followUpDate && lead.deadlineNotified !== true) {
            try {
                const deadline = new Date(lead.followUpDate);
                const deadlineStr = deadline.toISOString().split('T')[0];

                // If the deadline is today (or in the past and we haven't notified yet)
                if (deadlineStr <= todayStr) {
                    sendDeadlineMsg = true;
                }
            } catch (e) {
                console.error(`[Deadline Alerts] Invalid date format for lead ${doc.id}: ${lead.followUpDate}`);
            }
        }

        // --- 3. SEND NOTIFICATIONS ---
        if (sendAssignmentMsg || sendDeadlineMsg) {
            const assignee = lead.followUpAssignee;
            const user = USERS.find(u => (u.email || '').toLowerCase() === (assignee || '').toLowerCase());

            if (user && user.phone && user.phone !== '91xxxxxxxxxx') {
                try {
                    if (sendAssignmentMsg || sendDeadlineMsg) {
                        console.log(`[Deadline Alerts] Sending template notification to ${user.name} for lead ${lead.name}...`);
                        
                        let templateName = '';
                        let params = [];
                        
                        if (sendAssignmentMsg) {
                            // Using template: lead_assignment_v1
                            // Params: {{1}}=Name, {{2}}=Project, {{3}}=Follow-up Date
                            templateName = 'lead_assignment_v1';
                            params = [lead.name, lead.project || 'General', lead.followUpDate || 'Not set'];
                            updates.assignmentNotified = true;
                        } else {
                            // Using template: deadline_reminder_v1
                            // Params: {{1}}=Name, {{2}}=Project, {{3}}=Time
                            templateName = 'deadline_reminder_v1';
                            params = [lead.name, lead.project || 'General', lead.followUpDate];
                            updates.deadlineNotified = true;
                        }

                        // Actually send the template message
                        await sendWatiTemplate(user.phone, templateName, params);
                        await doc.ref.update(updates);
                    }
                } catch (err) {
                    console.error(`[Deadline Alerts] Failed to notify ${user.name}:`, err.response?.data || err.message);
                }
            } else {
                // If no user found or placeholder phone, still mark as notified to avoid infinite retries
                if (sendAssignmentMsg) updates.assignmentNotified = true;
                if (sendDeadlineMsg) updates.deadlineNotified = true;
                if (Object.keys(updates).length > 0) {
                    await doc.ref.update(updates);
                }
                console.log(`[Deadline Alerts] No valid user/phone for assignee "${assignee}". Marking as notified.`);
            }
        }
    }

    return null;
});
