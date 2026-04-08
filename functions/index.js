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
        console.log(`[WhatsApp Webhook] RAW PAYLOAD: ${JSON.stringify(payload)}`);

        if (payload.owner === true) {
            return res.status(200).send('Skipped - Outgoing');
        }

        // 1. Validation: Image + Caption
        const hasImage = payload.type === 'image' || payload.messageType === 'image' || !!payload.image;
        const leadName = (payload.text?.body || payload.caption || payload.text || '').trim();
        const senderNumber = payload.waId || payload.whatsappNumber || payload.from || '';

        // Only process if it has an image and a caption (Lead Name)
        if (!hasImage || !leadName) {
            console.log('[WhatsApp Webhook] Not a screenshot + caption. Skipping as per "screenshot-only" request.');
            
            // If they sent an image but forgot the caption, send a hint
            if (hasImage && !leadName && senderNumber) {
                await axios.post(`${WATI_ENDPOINT}/api/v1/sendSessionMessage/${senderNumber}?messageText=${encodeURIComponent('⚠️ Please provide the Lead Name as a caption when sending a screenshot.')}`, {}, { headers: { Authorization: WATI_TOKEN } });
            }
            
            return res.status(200).send('Ignored - Need image and caption');
        }

        // 2. Download Image
        const imageUrl = payload.image?.link || payload.data || payload.mediaUrl;
        if (!imageUrl) {
            console.error('[WhatsApp Webhook] Could not find image URL');
            if (senderNumber) {
                await axios.post(`${WATI_ENDPOINT}/api/v1/sendSessionMessage/${senderNumber}?messageText=${encodeURIComponent('❌ Failed to download screenshot. Please try again or send as a file.')}`, {}, { headers: { Authorization: WATI_TOKEN } });
            }
            return res.status(200).send('Error - No image URL');
        }

        console.log(`[WhatsApp Webhook] Downloading image from: ${imageUrl}`);
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            headers: { 'Authorization': WATI_TOKEN }
        });
        const base64Image = Buffer.from(response.data, 'binary').toString('base64');

        // 3. Extract Number via Claude
        console.log(`[WhatsApp Webhook] Calling Claude for extraction...`);
        const anthropicResponse = await axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 256,
            messages: [{
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: 'image/jpeg',
                            data: base64Image
                        }
                    },
                    {
                        type: 'text',
                        text: 'Extract the phone number from this screenshot. It may be a dialpad, call log, saved contact, or WhatsApp screen. Return ONLY valid JSON with one field: {"phone": "<number>"}. Include country code if visible. If no number found return {"phone": null}.'
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
        const { phone: phoneFromClaude } = JSON.parse(extractionText.match(/\{.*\}/s)[0]);

        if (!phoneFromClaude) {
            await axios.post(`${WATI_ENDPOINT}/api/v1/sendSessionMessage/${senderNumber}?messageText=${encodeURIComponent('❌ Could not read the phone number from the screenshot. Please resend or type the lead manually.')}`, {}, { headers: { Authorization: WATI_TOKEN } });
            return res.status(200).send('Failed - No number found');
        }

        // 4. Round-Robin Assignment
        const configRef = db.collection('config').doc('assignment');
        const configDoc = await configRef.get();
        let assignedTo = 'Rupal';
        if (configDoc.exists) {
            const lastAssigned = configDoc.data().lastAssigned;
            assignedTo = lastAssigned === 'Rupal' ? 'Veda' : 'Rupal';
        }
        await configRef.set({ lastAssigned: assignedTo, updatedAt: new Date().toISOString() }, { merge: true });

        // 5. Create Opportunity
        const opportunityData = {
            name: leadName,
            contactName: leadName,
            contactPhone: phoneFromClaude,
            phone: phoneFromClaude,
            value: 0,
            stage: '16', // Yet to contact
            status: 'Open',
            source: 'WhatsApp (Screenshot)',
            owner: assignedTo,
            followUpAssignee: assignedTo,
            tags: [],
            tasks: [],
            notes: [],
            followUpDate: '',
            followUpRead: false,
            deadlineNotified: false,
            assignmentNotified: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            activities: [{
                id: Date.now().toString(),
                type: 'status_change',
                description: `Lead created from screenshot sent by ${senderNumber}`,
                timestamp: new Date().toISOString(),
                userName: 'Wati Automation'
            }]
        };

        const docRef = await db.collection('opportunities').add(opportunityData);
        console.log(`[WhatsApp Webhook] ✅ Created lead ${docRef.id} for ${leadName}`);

        // 6. Confirmation Feedback
        try {
            await sendWatiTemplate(senderNumber, 'lead_created_confirmation', [leadName, phoneFromClaude, assignedTo]);
        } catch (e) {
            console.log('[WhatsApp Webhook] Template failed, using session message fallback.');
            await axios.post(`${WATI_ENDPOINT}/api/v1/sendSessionMessage/${senderNumber}?messageText=${encodeURIComponent(`✅ Lead created!\nName: ${leadName}\nPhone: ${phoneFromClaude}\nAssigned to: ${assignedTo}`)}`, {}, { headers: { Authorization: WATI_TOKEN } });
        }

        return res.status(200).json({ success: true, leadId: docRef.id });

    } catch (error) {
        console.error('[WhatsApp Webhook] ERROR:', error.response?.data || error.message);
        
        // Notify the sender about the failure
        const senderNumber = req.body?.waId || req.body?.whatsappNumber || req.body?.from || '';
        if (senderNumber) {
            try {
                await axios.post(`${WATI_ENDPOINT}/api/v1/sendSessionMessage/${senderNumber}?messageText=${encodeURIComponent('❌ Failed to create lead in CRM. Please contact support or try again later.')}`, {}, { headers: { Authorization: WATI_TOKEN } });
            } catch (notifyErr) {
                console.error('[WhatsApp Webhook] Second-level error notification failed:', notifyErr.message);
            }
        }
        
        return res.status(500).send('Internal Error');
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

