const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');

admin.initializeApp();
const db = admin.firestore();

// Wati Configuration from User
const WATI_TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1bmlxdWVfbmFtZSI6ImxlYWRzQGRpZ2l0YWxtb2pvLmluIiwibmFtZWlkIjoibGVhZHNAZGlnaXRhbG1vam8uaW4iLCJlbWFpbCI6ImxlYWRzQGRpZ2l0YWxtb2pvLmluIiwiYXV0aF90aW1lIjoiMDMvMjUvMjAyNiAxMTowMzo0OSIsInRlbmFudF9pZCI6IjEwMjc5NzEiLCJkYl9uYW1lIjoibXQtcHJvZC1UZW5hbnRzIiwiaHR0cDovL3NjaGVtYXMubWljcm9zb2Z0LmNvbS93cy8yMDA4LzA2L2lkZW50aXR5L2NsYWltcy9yb2xlIjoiQURNSU5JU1RSQVRPUiIsImV4cCI6MjUzNDAyMzAwODAwLCJpc3MiOiJDbGFyZV9BSSIsImF1ZCI6IkNsYXJlX0FJIn0.cIBcBq51XwIASupP4x9BLT8vN7-NdJ0cKM-6TDej3CM';
const WATI_ENDPOINT = 'https://live-mt-server.wati.io/1027971';

// Synchronized User List (from src/lib/admin.ts)
const USERS = [
    { name: 'Dhiraj', email: 'dhiraj@digitalmojo.in', phone: '91xxxxxxxxxx', isAdmin: true },
    { name: 'Srishti', email: 'srishti@digitalmojo.in', phone: '91xxxxxxxxxx', isAdmin: true },
    { name: 'Rupal', email: 'rupal@digitalmojo.in', phone: '91xxxxxxxxxx', isAdmin: false },
    { name: 'Veda', email: 'veda@digitalmojo.in', phone: '91xxxxxxxxxx', isAdmin: false },
    { name: 'Komal', email: 'komal@digitalmojo.in', phone: '91xxxxxxxxxx', isAdmin: false },
    { name: 'Aditya', email: 'aditya.digitalmojo@gmail.com', phone: '91xxxxxxxxxx', isAdmin: true }
];

/**
 * Webhook to handle incoming WhatsApp messages from Wati
 * Creates a lead in the CRM if the sender is authorized.
 */
exports.watiWebhook = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    try {
        const payload = req.body;
        const eventType = payload.eventType || payload.type;
        const senderNumber = payload.waId || payload.whatsappNumber || payload.senderNumber;
        const messageText = payload.text || payload.messageText || payload.data;

        if (eventType !== 'messageReceived' && eventType !== 'message-received') {
            return res.status(200).send('Ignored');
        }

        const cleanSender = senderNumber ? senderNumber.replace(/\D/g, '') : '';
        const isAuthorized = USERS.some(u => u.phone.replace(/\D/g, '') === cleanSender);

        if (!isAuthorized && cleanSender !== '91xxxxxxxxxx') {
            return res.status(403).send('Unauthorized');
        }

        const leadRegex = /Lead:\s*(.*?),\s*(.*?),\s*(.*?),\s*(.*?),\s*(.*)/i;
        const match = messageText.match(leadRegex);

        if (!match) {
            return res.status(400).send('Invalid Format');
        }

        const [_, name, phone, project, value, notes] = match;

        await db.collection('opportunities').add({
            name: name.trim(),
            phone: phone.trim(),
            project: project.trim(),
            value: parseFloat(value.trim().replace(/[^0-9.]/g, '')) || 0,
            notes: notes.trim(),
            stage: '16', // Yet to contact
            status: 'Open',
            source: 'WhatsApp (Wati)',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            deadlineNotified: false,
            activities: [
                {
                    type: 'status_change',
                    field: 'Source',
                    oldValue: 'None',
                    newValue: 'Lead Created via WhatsApp Automation',
                    timestamp: new Date().toISOString(),
                    userName: 'Wati Automation'
                }
            ]
        });

        return res.status(200).send('Success');
    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).send('Internal Error');
    }
});

/**
 * Scheduled function to check for approaching deadlines
 * Sends a WhatsApp notification to the assignee via Wati.
 */
exports.checkDeadlines = functions.pubsub.schedule('every 10 minutes').onRun(async (context) => {
    const now = new Date();
    // Look for deadlines in the next 15 minutes that haven't been notified yet
    const windowEnd = new Date(now.getTime() + 15 * 60 * 1000);

    const snapshot = await db.collection('opportunities')
        .where('status', '==', 'Open')
        .where('deadlineNotified', '==', false)
        .get();

    for (const doc of snapshot.docs) {
        const lead = doc.data();
        if (!lead.followUpDate) continue;

        const deadline = new Date(lead.followUpDate);

        // If deadline is within our window (and not in the past too far)
        if (deadline <= windowEnd && deadline >= new Date(now.getTime() - 60 * 60 * 1000)) {
            const assignee = lead.followUpAssignee; // email or name
            const user = USERS.find(u => u.email === assignee || u.name === assignee);

            if (user && user.phone && user.phone !== '91xxxxxxxxxx') {
                try {
                    const message = `🔔 *CRM DEADLINE ALERT*\n\nUser: ${user.name}\nLead: ${lead.name}\nProject: ${lead.project}\nDeadline: ${lead.followUpDate}\n\nPlease take action!`;

                    await axios.post(`${WATI_ENDPOINT}/api/v1/sendSessionMessage/${user.phone}?messageText=${encodeURIComponent(message)}`, {}, {
                        headers: { 'Authorization': WATI_TOKEN }
                    });

                    await doc.ref.update({ deadlineNotified: true });
                    console.log(`Notification sent to ${user.name} for lead ${lead.name}`);
                } catch (err) {
                    console.error(`Failed to notify ${user.name}:`, err.message);
                }
            }
        }
    }
});
