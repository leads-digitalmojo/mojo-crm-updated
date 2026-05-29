const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { Anthropic } = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const {
    isBusinessHours,
    triggerHuskyvoiceCall,
    huskyvoiceWebhook,
    processPendingAICalls
} = require('./huskyvoice');

admin.initializeApp();
const getDb = () => admin.firestore();

// Wati Configuration from User
const WATI_TOKEN = process.env.WATI_TOKEN;
const WATI_ENDPOINT = process.env.WATI_ENDPOINT;
const getAnthropicKey = () => process.env.ANTHROPIC_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Provided by User
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const getGeminiKey = () => process.env.GEMINI_API_KEY;
const getMetaToken = () => process.env.META_ACCESS_TOKEN;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const SALESTRAIL_AUTH = process.env.SALESTRAIL_AUTH;
const SALESTRAIL_BASE_URL = process.env.SALESTRAIL_BASE_URL;

// Synchronized User List (from src/lib/admin.ts)
const USERS = [
    { name: 'Dhiraj', email: 'dhiraj@digitalmojo.in', phone: '919908398763', isAdmin: true, id: '58Ba96qczERiK7DzBbMkpoko7Vx1' },
    { name: 'Srishti', email: 'srishti@digitalmojo.in', phone: '919899488155', isAdmin: true, id: 'srishti-mojo-id' },
    { name: 'Rupal', email: 'rupal@digitalmojo.in', phone: '919676670777', isAdmin: false, id: 'UNUwlgtVDUc6c9uQVMvBiYjmBYB2' },
    { name: 'Veda', email: 'veda@digitalmojo.in', phone: '919032157788', isAdmin: false, id: '6l7loPF90teRjJxy61ABWH5GUvX2' },
    { name: 'Komal', email: 'komal@digitalmojo.in', phone: '917981245752', isAdmin: false, id: 'OwGcGoDXKdPVAMBNTyrY8nDqpmm2' },
    { name: 'Aditya', email: 'aditya.digitalmojo@gmail.com', phone: '918017699390', isAdmin: true, id: 'aditya-mojo-id' },
];

const RED_FLAG_STAGES = ['16', '16.5', '21', '20.5', '20', '19', '18', '17'];
const RED_OWNER_REQUIRED = true; // Exclude unassigned leads from Red Flags

/**
 * Helper to send a Wati Session Message (regular text).
 * Only works if the user has messaged in the last 24 hours.
 */
async function sendWatiSessionMessage(phone, text) {
    const axios = require('axios');
    const url = `${WATI_ENDPOINT}/api/v1/sendSessionMessage/${phone}?messageText=${encodeURIComponent(text)}`;
    try {
        console.log(`[Wati API] Sending session message to ${phone}...`);
        const response = await axios.post(url, {}, {
            headers: { 'Authorization': WATI_TOKEN }
        });
        return response.data;
    } catch (error) {
        console.error(`[Wati API] Error sending session message to ${phone}:`, error.response?.data || error.message);
        throw error;
    }
}

/**
 * Helper to notify Dhiraj about a new call analysis.
 */
async function notifyDhirajAboutCallAnalysis(leadName, analysis, callUserName) {
    // We now use notifyTeamMember which handles both templates (for reliability) and session messages
    await notifyTeamMember('dhiraj@digitalmojo.in', {
        type: 'analysis',
        leadName: leadName,
        callUser: callUserName,
        rating: analysis.rating || 0,
        summary: analysis.summary || 'No summary provided.'
    });
}

/**
 * Helper to send a Wati Template Message.
 * This works even if the 24-hour session window is closed.
 */
async function sendWatiTemplate(phone, templateName, parameters) {
    const axios = require('axios');
    const url = `${WATI_ENDPOINT}/api/v1/sendTemplateMessage?whatsappNumber=${phone}`;
    const payload = {
        template_name: templateName,
        broadcast_name: `CRM_${templateName}_${Date.now()}`,
        parameters: parameters.map((val, index) => ({
            name: (index + 1).toString(),
            value: (val || 'N/A').toString().replace(/[\n\t]/g, ' ').replace(/\s+/g, ' ').trim()
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
 * Helper to send a Wati Template Message with Media (PDF/Image).
 */
async function sendWatiMediaTemplate(phone, templateName, parameters, mediaUrl) {
    const axios = require('axios');
    const url = `${WATI_ENDPOINT}/api/v1/sendTemplateMessage?whatsappNumber=${phone}`;
    const payload = {
        template_name: templateName,
        broadcast_name: `CRM_MEDIA_${templateName}_${Date.now()}`,
        media: {
            url: mediaUrl,
            filename: "Sales_Deck.pdf"
        },
        parameters: parameters.map((val, index) => ({
            name: (index + 1).toString(),
            value: (val || 'N/A').toString().replace(/[\n\t]/g, ' ').replace(/\s+/g, ' ').trim()
        }))
    };

    try {
        console.log(`[Wati API] Sending media template "${templateName}" to ${phone} with URL: ${mediaUrl}`);
        const response = await axios.post(url, payload, {
            headers: { 'Authorization': WATI_TOKEN }
        });
        return response.data;
    } catch (error) {
        console.error(`[Wati API] Error sending media template "${templateName}" to ${phone}:`, error.response?.data || error.message);
        throw error;
    }
}

/**
 * Orchestrates the full lead communication sequence:
 * 1. Welcome Message (Session)
 * 2. Sales Asset PDF 1
 * 3. Sales Asset PDF 2
 * 4. Discovery Form Link
 */
async function sendLeadWelcomeSequence(phone, leadName, assignedName, opportunityId) {
    const db = admin.firestore();
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
        console.log(`[Welcome Sequence] Skipping: Invalid phone number ${phone}`);
        return;
    }

    try {
        console.log(`[Welcome Sequence] Starting consolidated welcome message for ${cleanPhone} (Lead: ${opportunityId})...`);

        // 1. Fetch Asset URLs from settings
        const settingsDoc = await db.collection('settings').doc('sales_assets').get();
        if (!settingsDoc.exists) {
            console.error('[Welcome Sequence] Sales assets settings missing.');
            return;
        }

        const { pdf1Url, formUrl } = settingsDoc.data();
        if (!pdf1Url || !formUrl) {
            console.error('[Welcome Sequence] Asset URLs incomplete in settings.');
            return;
        }

        // 2. Send Consolidated Welcome Message (Media Template)
        // Template 'lead_welcome_v2' includes:
        // Header: PDF (pdf1Url)
        // Body: 1:leadName, 2:assignedName, 3:formUrl
        try {
            await sendWatiMediaTemplate(cleanPhone, 'lead_welcome_v3', [
                leadName || 'there',
                assignedName,
                formUrl
            ], pdf1Url);

            const sentAt = new Date().toISOString();
            await db.collection('opportunities').doc(opportunityId).update({
                welcomeMessageSent: true,
                welcomeMessageSentAt: sentAt,
                lastSalesAssetsSent: sentAt,
                updatedAt: sentAt
            });
            console.log(`[Welcome Sequence] ✅ Consolidated media template sent to ${leadName}`);
        } catch (err) {
            console.error(`[Welcome Sequence] Failed to send consolidated message:`, err.message);
            throw err;
        }

    } catch (error) {
        console.error(`[Welcome Sequence] Fatal error for ${opportunityId}:`, error.message);
    }
}

/**
 * Helper to normalize phone numbers for comparison.
/**
 * Helper to normalize phone numbers for comparison and storage.
 * Simply strips non-digits to keep country codes intact.
 */
function normalizePhone(phone) {
    if (!phone) return '';
    const cleaned = String(phone).replace(/\D/g, '');
    return cleaned.length >= 10 ? cleaned.slice(-10) : cleaned;
}

/**
 * Helper to extract true duration from a recording URL.
 * Uses music-metadata to parse audio stream headers.
 */
async function getTrueDuration(url, authHeader) {
    if (!url) return null;
    const axios = require('axios');
    const mm = require('music-metadata');

    try {
        console.log(`[Metadata] Extracting duration for: ${url.substring(0, 80)}...`);
        const response = await axios({
            method: 'get',
            url: url,
            headers: authHeader ? { 'Authorization': authHeader } : {},
            responseType: 'stream'
        });

        const metadata = await mm.parseStream(response.data, {
            mimeType: 'video/mp4', // Salestrail recordings are usually .mp4/m4a
            size: parseInt(response.headers['content-length'])
        });

        const duration = Math.round(metadata.format.duration);
        console.log(`[Metadata] Extracted true duration: ${duration}s (Original was incorrect)`);

        // Clean up: stop the stream after parsing headers to save bandwidth
        response.data.destroy();

        return (duration > 0 && duration < 36000) ? duration : null; // Cap at 10h just in case
    } catch (error) {
        console.warn(`[Metadata] Failed to extract from recording: ${error.message}`);
        return null;
    }
}

/**
 * Helper to get the current date in YYYY-MM-DD format (IST)
 */
function getInIST(date = new Date()) {
    // Offset for IST is +5h 30m
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    return new Date(utc + IST_OFFSET);
}

function getISTDateString() {
    const d = getInIST();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Calculates the Session Start time for a lead based on its creation time.
 * If created during working hours (Mon-Fri 10:00-19:30 IST), returns the creation time.
 * Otherwise, returns the 10:00 AM of the next working day.
 */
function getSessionStart(date) {
    const ist = getInIST(date);
    const day = ist.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const hour = ist.getHours();
    const min = ist.getMinutes();
    const timeVal = hour * 100 + min;

    const isWeekend = (day === 0 || day === 6);
    const isBeforeWork = timeVal < 1000;
    const isAfterWork = timeVal >= 1930;

    if (!isWeekend && !isBeforeWork && !isAfterWork) {
        // During working hours
        return ist;
    }

    // Off-hours: Map to next available 10:00 AM
    let sessionDate = new Date(ist);
    sessionDate.setHours(10, 0, 0, 0);

    // If it's late night or early morning, we might need to push to next day or Monday
    if (isAfterWork) {
        sessionDate.setDate(sessionDate.getDate() + 1);
    }

    // Check if the resulting sessionDate is a weekend
    while (sessionDate.getDay() === 0 || sessionDate.getDay() === 6) {
        sessionDate.setDate(sessionDate.getDate() + 1);
    }

    return sessionDate;
}

/**
 * AI CALL ANALYSIS: Analyze audio recording using Gemini 1.5 Pro
 */
async function analyzeCallWithGemini(audioUrl, leadName = "Unknown") {
    if (!audioUrl) return null;
    console.log(`[AI Analysis] Starting analysis for: ${leadName}`);

    const axios = require('axios');
    let audioData;
    try {
        const response = await axios.get(audioUrl, {
            responseType: 'arraybuffer',
            headers: { 'Authorization': SALESTRAIL_AUTH },
            timeout: 30000
        });
        audioData = response.data;
        console.log(`[AI Analysis] Fetched audio: ${audioData.byteLength} bytes`);
    } catch (error) {
        console.error(`[AI Analysis] Audio fetch error for ${leadName}:`, error.message);
        return null;
    }

    const prompt = `You are an expert sales coach. You follow methodologies of Zig Ziglar in sales. You will listen into the call and rate it on a scale of 1-10. What needs to be analysed is how the team member is performing. It has to correlate with a 20+ years sales expert. Like showcasing pain behind the pain. Providing solution, dealing with objection handling. If they are lukewarm with follow up calls like I just called to follow up then rank them lower. Analyze this call recording and provide a JSON response with:
    {
        "rating": number (1-10),
        "summary": "A single punchy sentence that captures the essence of how this call went — like a headline",
        "goodFeatures": ["Specific thing they did well with example from the call", "Another specific strength", "Third strength if applicable"],
        "improvements": ["Most critical thing to fix with specific suggestion", "Second improvement area with actionable advice", "Third improvement if needed"],
        "failureReasons": "If rating is below 6, explain in 2-3 sentences exactly why they failed and what specific moments in the call brought the rating down. If rating is 6 or above leave this as null."
    }
    Be specific — reference actual moments from the call. Format your response as a valid JSON object only. No markdown.`;

    // Standard verified models for multimodal (audio) support
    const modelsToTry = [
        'gemini-2.5-flash',       // Primary stable (2026)
        'gemini-2.5-pro',        // High quality fallback
        'gemini-2.0-flash',       // Legacy stable
        'gemini-flash-latest'     // Generic alias
    ];

    let lastError = "Unknown error";
    for (const modelName of modelsToTry) {
        try {
            console.log(`[AI Analysis]Attempting with model: ${modelName} `);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent([
                {
                    inlineData: {
                        mimeType: "audio/mpeg",
                        data: Buffer.from(audioData).toString("base64")
                    }
                },
                prompt
            ]);

            const response = await result.response;
            let text = response.text();
            text = text.replace(/```json\n ?|\n ? ```/g, '').trim();

            const analysis = JSON.parse(text);
            console.log(`[AI Analysis] Success! Rating for ${leadName}: ${analysis.rating}/10`);
            return analysis;
        } catch (error) {
            lastError = error.message;
            console.warn(`[AI Analysis] Model ${modelName} failed:`, error.message);

            // If it's a quota error (429), we stop trying other models as they share the same quota
            if (error.message.includes('429') || error.message.includes('Quota')) {
                console.error(`[AI Analysis] Quota reached for Gemini API.`);
                throw new Error("Gemini API Quota Exceeded. Please try again tomorrow.");
            }

            // If it's a 503 (busy), wait a tiny bit before trying the next model
            if (error.message.includes('503')) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }
    return null;
}

/**
 * AI DISCOVERY ANALYSIS: Analyze form responses using Gemini 1.5 Flash
 */
exports.analyzeDiscoveryResponse = functions.https.onCall(async (data, context) => {
    // Check auth
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const { responseId, responses } = data;
    if (!responses) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing form responses.');
    }

    console.log(`[AI Discovery] Analyzing responses for: ${responseId}`);

    const responsesText = Object.entries(responses)
        .map(([q, a]) => `Question: ${q}\nAnswer: ${a}`)
        .join('\n\n');

    const prompt = `You are an elite sales consultant. Analyze these discovery form responses from a potential lead and provide a JSON report to help the sales team close the deal.

RESPONSES:
${responsesText}

Provide a JSON response with:
{
    "strategy": "A 2-3 sentence high-level strategy on how to handle this lead.",
    "talkingPoints": ["Point 1", "Point 2", "Point 3"],
    "openingScript": "A suggested opening line for the discovery call.",
    "hotButtons": ["What they care about most"],
    "concerns": ["Potential objections to watch out for"]
}
Format your response as a valid JSON object only. No markdown.`;

    try {
        const modelsToTry = [
            'gemini-2.5-flash',
            'gemini-2.5-pro',
            'gemini-2.0-flash',
            'gemini-1.5-flash'
        ];

        let analysis = null;
        let lastError = null;

        for (const modelName of modelsToTry) {
            try {
                console.log(`[AI Discovery] Attempting with model: ${modelName}`);
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                let text = response.text();
                text = text.replace(/```json\n?|\n?```/g, '').trim();

                analysis = JSON.parse(text);
                if (analysis) break;
            } catch (err) {
                console.warn(`[AI Discovery] Model ${modelName} failed:`, err.message);
                lastError = err;
            }
        }

        if (!analysis) throw lastError || new Error('All Gemini models failed');

        // Optional: Save to Firestore if responseId is provided
        if (responseId) {
            await getDb().collection('discovery_responses').doc(responseId).update({
                aiAnalysis: analysis,
                aiAnalyzedAt: new Date().toISOString()
            });
        }

        return analysis;
    } catch (error) {
        console.error('[AI Discovery] Error:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

/**
 * Helper to safely notify a team member if they are in the whitelist
 */
async function notifyTeamMember(email, messageData) {
    const axios = require('axios');
    const user = USERS.find(u => u.email.toLowerCase() === (email || '').toLowerCase());
    if (!user || !user.phone || user.phone === '91xxxxxxxxxx') {
        console.log(`[Notifications] Skipping notification for ${email} (Non-whitelisted or invalid phone)`);
        return false;
    }

    const { type, leadName, leadPhone, project, followUpDate, context } = messageData;
    const displayLeadName = leadPhone ? `${leadName} (${leadPhone})` : leadName;

    try {
        if (type === 'deadline') {
            const templateName = 'deadline_reminder_v1';
            const params = [displayLeadName, project || 'General', context || 'Deadline Alert', leadPhone || 'N/A'];

            try {
                await sendWatiTemplate(user.phone, templateName, params);
            } catch (e) {
                console.log(`[Notifications] Template failed for ${user.name}, falling back to session message.`);
                const text = `⏰ *Deadline Alert*\n\nLead: ${displayLeadName}\nPhone: ${leadPhone || 'N/A'}\nProject: ${project || 'N/A'}\nFollow-up: ${followUpDate || 'Not set'}\n\n${context}`;
                await axios.post(`${WATI_ENDPOINT}/api/v1/sendSessionMessage/${user.phone}?messageText=${encodeURIComponent(text)}`, {}, { headers: { Authorization: WATI_TOKEN } });
            }
        } else if (type === 'analysis') {
            const templateName = 'call_analysis_v1';
            const params = [
                displayLeadName,
                messageData.callUser || 'Team Member',
                `${messageData.rating || 0}/10`,
                messageData.summary || 'No summary'
            ];

            try {
                await sendWatiTemplate(user.phone, templateName, params);
            } catch (e) {
                console.log(`[Notifications] Analysis template failed for ${user.name}, falling back to session message.`);
                const text = `📊 *AI Call Analysis*\n\nLead: ${displayLeadName}\nUser: ${messageData.callUser}\nRating: ${messageData.rating}/10\n\nReview: ${messageData.summary}`;
                await axios.post(`${WATI_ENDPOINT}/api/v1/sendSessionMessage/${user.phone}?messageText=${encodeURIComponent(text)}`, {}, { headers: { Authorization: WATI_TOKEN } });
            }
        } else if (type === 'assignment') {
            const templateName = 'lead_assignment_v1';
            const params = [displayLeadName, project || 'General', followUpDate || 'Not set', leadPhone || 'N/A'];

            try {
                await sendWatiTemplate(user.phone, templateName, params);
            } catch (e) {
                console.log(`[Notifications] Assignment template failed for ${user.name}, falling back to session message.`);
                const text = `🔔 *New Lead Assigned*\n\nLead: ${displayLeadName}\nPhone: ${leadPhone || 'N/A'}\nProject: ${project || 'N/A'}\nFollow-up: ${followUpDate || 'Not set'}\n\nGood luck!`;
                await axios.post(`${WATI_ENDPOINT}/api/v1/sendSessionMessage/${user.phone}?messageText=${encodeURIComponent(text)}`, {}, { headers: { Authorization: WATI_TOKEN } });
            }
        }
        return true;
    } catch (err) {
        console.error(`[Notifications] Failed to notify ${user.name}:`, err.message);
        return false;
    }
}

/**
 * Helper to get the next assignee in a round-robin (Rupal vs Veda)
 */
async function getNextAssignee() {
    const db = getDb();
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

    return { name: assignedName, email: assignedTo };
}

/**
 * Proxy to fetch recording audio securely.
 * Prevents the browser from showing a Basic Auth popup.
 */
exports.getRecordingAudio = functions.https.onRequest(async (req, res) => {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.status(204).send('');
        return;
    }

    const axios = require('axios');
    const recordingUrl = req.query.url;

    if (!recordingUrl || !recordingUrl.startsWith('https://standalone-api.salestrail.io')) {
        return res.status(400).send('Invalid or missing recording URL');
    }

    try {
        console.log(`[Audio Proxy] Fetching: ${recordingUrl}`);
        const response = await axios({
            method: 'get',
            url: recordingUrl,
            responseType: 'stream',
            headers: { 'Authorization': SALESTRAIL_AUTH }
        });

        // Forward headers
        res.set('Content-Type', response.headers['content-type'] || 'audio/mpeg');
        if (response.headers['content-length']) {
            res.set('Content-Length', response.headers['content-length']);
        }

        // Pipe the stream
        response.data.pipe(res);
    } catch (error) {
        console.error('[Audio Proxy] Error:', error.message);
        res.status(error.response?.status || 500).send('Error fetching recording');
    }
});

/**
 * Webhook to receive WhatsApp messages from Wati.
 *
 * This webhook is RESILIENT: it accepts ANY incoming message and creates a lead.
 * If the message follows the "Lead: Name, Phone, Project, Value, Notes" format, it
 * parses those fields. Otherwise, it uses the sender's Wati contact info as a fallback.
 */
exports.whatsappWebhook = functions.runWith({ timeoutSeconds: 60, memory: '512MB' }).region('us-central1').https.onRequest(async (req, res) => {
    const axios = require('axios');
    const db = getDb();
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    try {
        const payload = req.body;
        console.log(`[WhatsApp Webhook] RAW PAYLOAD: ${JSON.stringify(payload)}`);

        // 0. IDEMPOTENCY: Skip if we already processed this message ID
        // Use whatsappMessageId as primary key, fallback to event ID
        const messageId = payload.whatsappMessageId || payload.id;
        if (messageId) {
            const processedRef = db.collection('processed_messages').doc(messageId);
            const processedDoc = await processedRef.get();
            if (processedDoc.exists) {
                console.log(`[WhatsApp Webhook] Skip - Message ID ${messageId} already processed.`);
                return res.status(200).send('Already Processed');
            }

            // Mark as processed immediately to prevent retries/loops during long-running Gemini calls
            await processedRef.set({
                processedAt: new Date().toISOString(),
                status: 'processing'
            });
        }

        // 1. FILTERING: Only process 'message' event types
        // Wati sends events like 'sentMessageREAD', 'sentMessageREPLIED', etc.
        const eventType = payload.eventType || '';
        if (eventType && eventType !== 'message') {
            console.log(`[WhatsApp Webhook] Ignoring non-message event: ${eventType}`);
            return res.status(200).send('Ignored - Non-message event');
        }

        // 2. Extract raw text and media
        const rawText = (payload.text?.body || payload.text || payload.messageText || payload.caption || payload.data || '').trim();
        const msgType = payload.type || 'text';

        // In Wati, if it's an image, 'data' or 'url' usually contains the link.
        // We'll treat it as a media message if type is image OR if the text is a link to an image.
        const isImageUrl = (rawText.startsWith('http') && (rawText.includes('.jpg') || rawText.includes('.png') || rawText.includes('.jpeg')));
        const mediaUrl = (msgType === 'image' || isImageUrl) ? (payload.data || payload.url || (isImageUrl ? rawText : null)) : null;

        if (!rawText && !mediaUrl) {
            console.log('[WhatsApp Webhook] Ignored - Empty message body');
            return res.status(200).send('Ignored - Empty');
        }

        // 3. Authorization Check
        const senderNumber = normalizePhone(payload.waId || payload.whatsappNumber || payload.from || '');
        const authorizedPhones = USERS.map(u => normalizePhone(u.phone));

        if (!authorizedPhones.includes(senderNumber)) {
            console.log(`[WhatsApp Webhook] 🛑 Unauthorized attempt from: ${senderNumber}`);
            return res.status(200).send('Unauthorized');
        }

        const axios = require('axios');

        // 4. Fetch image if present (OCR Support)
        let imagePart = null;
        if (mediaUrl) {
            try {
                console.log(`[WhatsApp Webhook] Fetching media from Wati...`);
                const headers = {};
                if (mediaUrl.includes('wati.io')) {
                    headers['Authorization'] = WATI_TOKEN;
                }

                const imgResp = await axios.get(mediaUrl, {
                    responseType: 'arraybuffer',
                    timeout: 15000,
                    headers: headers
                });

                const base64Img = Buffer.from(imgResp.data).toString('base64');
                const contentType = imgResp.headers['content-type'] || 'image/jpeg';

                imagePart = {
                    inline_data: {
                        mime_type: contentType.includes('image') ? contentType : "image/jpeg",
                        data: base64Img
                    }
                };
                console.log(`[WhatsApp Webhook] Media fetched successfully (${contentType})`);
            } catch (error) {
                console.error('[WhatsApp Webhook] Media fetch failed:', error.response?.status || error.message);
            }
        }

        // 5. Call Gemini for Lead Extraction
        console.log('[WhatsApp Webhook] Calling Gemini for extraction...');
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const yourExtractionPrompt = `You are an expert lead extraction assistant. Extract lead information from this WhatsApp message and/or screenshot.
        
        CONTEXT:
        The screenshot is likely from an Android/iPhone and could be a Call Log, Contact Details, or Dialpad. PERFORM DEEP OCR to find phone numbers and names.

        STRICT NAME RULE:
        - **PRIORITIZE THE INPUT CAPTION**: If 'Input Caption' contains a person's name (e.g., "Mohmmad Safhi"), USE THAT as the name.
        - Only use the OCR name from the image if the 'Input Caption' is empty or doesn't specify a name.
        - If the image contains a name that differs from the caption, assume the CAPTION is the correct, updated name.

        PHONE RULES:
        1. **Phone Number is Mandatory**: Scan the image for any series of digits. Strip all non-digits.
        2. **Preserve Format**: Return exactly what you find (digits only). Do not auto-prepend 91 or any country code unless it was explicitly part of the number in the source.
        3. **Clean Formatting**: No spaces, dashes, or brackets in the phone field.

        Return ONLY a JSON object:
        {
          "name": "string or null",
          "phone": "string_digits_only",
          "email": "string or null",
          "budget": "string or null",
          "website": "string or null",
          "country": "string (2-letter ISO) or null",
          "requirements": "string or null",
          "notes": "string or null"
        }
        make sure you check the number before sending and it does not have 9191 like that fix it to having only 91 if applicable we also get different country codes so always recheck.
        Input Caption: ${rawText}`;

        const parts = [];
        if (imagePart) {
            parts.push(imagePart);
        }
        parts.push({ text: yourExtractionPrompt });

        const result = await model.generateContent(parts);
        const extractionText = result.response.text();
        console.log(`[WhatsApp Webhook] Gemini Response: ${extractionText}`);

        // Match JSON object
        const jsonMatch = extractionText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error('[WhatsApp Webhook] Could not find JSON in Gemini response');
            return res.status(200).send('Extraction Failed - No JSON');
        }

        const extracted = JSON.parse(jsonMatch[0]);

        // 4. Validation: Need at least name or phone
        if (!extracted.name && !extracted.phone) {
            console.log('[WhatsApp Webhook] Both name and phone are null. Skipping lead creation.');
            return res.status(200).send('Skipped - Insufficient data');
        }

        // 5. Deduplication: Check if lead already exists by phone
        if (extracted.phone) {
            const normalizedExtractedPhone = normalizePhone(extracted.phone);
            const existingSnapshot = await db.collection('opportunities')
                .where('phone', '==', normalizedExtractedPhone)
                .limit(1)
                .get();

            if (!existingSnapshot.empty) {
                console.log(`[WhatsApp Webhook] Skip - Lead with phone ${normalizedExtractedPhone} already exists.`);
                // Still send confirmation to boss that it was recognized
                const existingLead = existingSnapshot.docs[0].data();
                const senderNumber = normalizePhone(payload.waId || payload.whatsappNumber || payload.from || '');

                try {
                    await sendWatiTemplate(senderNumber, 'lead_created_confirmation', [
                        existingLead.name || 'Existing Lead',
                        normalizedExtractedPhone,
                        `${existingLead.owner || 'N/A'} (Existing Lead)`
                    ]);
                } catch (e) {
                    const confirmationText = `✅ Lead already exists!\nName: ${existingLead.name}\nPhone: ${normalizedExtractedPhone}\nAssigned to: ${existingLead.owner}`;
                    await axios.post(`${WATI_ENDPOINT}/api/v1/sendSessionMessage/${senderNumber}?messageText=${encodeURIComponent(confirmationText)}`, {}, { headers: { Authorization: WATI_TOKEN } });
                }

                // Mark as fully processed even on duplicate to prevent loops
                if (messageId) {
                    await db.collection('processed_messages').doc(messageId).update({
                        status: 'duplicate_skipped',
                        leadId: existingSnapshot.docs[0].id
                    });
                }
                return res.status(200).send('Duplicate Lead - Skipped');
            }
        }

        // 6. Round-Robin Assignment (Rupal vs Veda)
        const { name: assignedName, email: assignedTo } = await getNextAssignee();

        // 6. Build Notes
        const notesArray = [rawText];
        if (extracted.notes) {
            notesArray.push(extracted.notes);
        }

        // 7. Check if Test Number for AI Calling
        const settingsSnap = await db.collection('settings').doc('huskyvoice').get();
        const testNumbers = settingsSnap.exists ? settingsSnap.data().test_phone_numbers || [] : [];
        const normalizedPhoneValue = normalizePhone(extracted.phone);
        const normalizedTestNumbers = testNumbers.map(n => normalizePhone(n));
        const isTestNumber = normalizedTestNumbers.includes(normalizedPhoneValue);

        // 8. Create Opportunity Document
        const displayLeadName = extracted.name || extracted.phone || 'WhatsApp Lead';
        const opportunityData = {
            name: displayLeadName,
            contactName: displayLeadName,
            contactPhone: normalizedPhoneValue,
            contactEmail: extracted.email || '',
            phone: normalizedPhoneValue,
            secondaryPhones: [], // Initialize list for extras
            value: 0,
            budget: extracted.budget || '',
            your_website: extracted.website || '',
            country: extracted.country || null,
            source: 'WhatsApp',
            stage: '16',
            status: 'Open',
            owner: assignedTo,
            followUpAssignee: assignedTo,
            isAIPending: isTestNumber,
            aiCallStatus: isTestNumber ? 'Scheduled' : null,
            tags: extracted.requirements ? [extracted.requirements] : [],
            tasks: [],
            notes: [
                {
                    id: Date.now().toString(),
                    content: `Original Message: ${rawText}`,
                    createdAt: new Date().toISOString()
                },
                ...(extracted.notes ? [{
                    id: (Date.now() + 1).toString(),
                    content: `Extracted Notes: ${extracted.notes}`,
                    createdAt: new Date().toISOString()
                }] : [])
            ],
            followUpDate: '',
            followUpRead: false,
            deadlineNotified: false,
            assignmentNotified: false,
            redFlagSent: false,
            urgentAlertSent: false,
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

        if (isTestNumber) {
            console.log(`[WhatsApp Webhook] Lead ${normalizedPhoneValue} is a test number for Huskyvoice.`);
            if (isBusinessHours()) {
                await triggerHuskyvoiceCall(docRef.id, opportunityData);
            } else {
                console.log(`[WhatsApp Webhook] Outside business hours. Call scheduled for later.`);
            }
        }

        // Note: The welcome sequence is now handled automatically by the onOpportunityCreate trigger
        // to ensure consistency across all lead sources (WhatsApp, Website, Manual).

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

        // 10. FINALLY mark as completed
        if (messageId) {
            await db.collection('processed_messages').doc(messageId).update({
                status: 'completed',
                leadId: docRef.id,
                completedAt: new Date().toISOString()
            });
        }

        return res.status(200).json({ success: true, leadId: docRef.id, name: displayLeadName });

    } catch (error) {
        console.error('[WhatsApp Webhook] ERROR:', error.response?.data || error.message);

        // Return 200 to prevent Wati from retrying and causing spam
        // We send exactly ONE message to notify the user of the failure gracefully
        try {
            const senderNumber = normalizePhone(req.body.waId || req.body.whatsappNumber || req.body.from || '');
            if (senderNumber) {
                const errorMsg = `⚠️ Extraction failed: ${error.message}\n\nPlease check your balance or logs.`;
                await axios.post(`${WATI_ENDPOINT}/api/v1/sendSessionMessage/${senderNumber}?messageText=${encodeURIComponent(errorMsg)}`, {}, { headers: { Authorization: WATI_TOKEN } });
            }
        } catch (notifyErr) {
            console.error('[WhatsApp Webhook] Failed to send error notification:', notifyErr.message);
        }

        return res.status(200).send(`Error handled and user notified: ${error.message}`);
    }
});

/**
 * Scheduled function to check for lead follow-up deadlines and new assignments every 10 minutes
 */
exports.deadlineAlerts = functions.pubsub.schedule('every 10 minutes').onRun(async (context) => {
    const db = getDb();
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
        if (lead.followUpAssignee && lead.assignmentNotified === false) {
            const sent = await notifyTeamMember(lead.followUpAssignee, {
                type: 'assignment',
                leadName: lead.name,
                leadPhone: lead.contactPhone || lead.phone,
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
                leadPhone: lead.contactPhone || lead.phone,
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
        const db = getDb();
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
                    leadPhone: lead.contactPhone || lead.phone,
                    project: lead.project,
                    followUpDate: lead.followUpDate,
                    context: 'Morning Reminder: You have a follow-up scheduled for today.'
                });
                if (sent) await doc.ref.update({ deadlineNotifiedAt: today });
            }
        }

        return null;
    });

/**
 * NEW: Scheduled function to alert for uncontacted leads within 5 minutes.
 * Runs every minute to catch leads precisely around the 5-minute mark.
 */
exports.checkUrgentLeads = functions.pubsub.schedule('every 1 minutes').onRun(async (context) => {
    const db = getDb();
    const nowIST = getInIST();

    // Working Hours Check: Monday-Friday, 10:00 AM - 7:30 PM IST
    const day = nowIST.getDay();
    const hour = nowIST.getHours();
    const min = nowIST.getMinutes();
    const timeVal = hour * 100 + min;

    if (day === 0 || day === 6 || timeVal < 1000 || timeVal > 1930) {
        console.log(`[Urgent Alerts] Outside working hours (${nowIST.toString()}). skipping...`);
        return null;
    }

    console.log(`[Urgent Alerts] Checking leads at ${nowIST.toString()}...`);

    const snapshot = await db.collection('opportunities')
        .where('status', '==', 'Open')
        .where('stage', '==', '16')
        .get();

    if (snapshot.empty) {
        console.log(`[Urgent Alerts] No Stage 16 leads found.`);
        return null;
    }

    // Filter in JS to handle cases where urgentAlertSent is missing (not yet initialized)
    const pendingLeads = snapshot.docs.filter(doc => {
        const data = doc.data();
        return data.urgentAlertSent !== true;
    });

    if (pendingLeads.length === 0) {
        console.log(`[Urgent Alerts] No pending Stage 16 leads (all alerted).`);
        return null;
    }

    console.log(`[Urgent Alerts] Found ${pendingLeads.length} leads to evaluate.`);

    // Group leads by their Session Start to handle staggering
    const leads = pendingLeads.map(doc => ({ id: doc.id, ref: doc.ref, ...doc.data() }));

    // Add sessionStart info to each lead
    leads.forEach(l => {
        l.createdAtDate = l.createdAt ? new Date(l.createdAt) : new Date();
        l.sessionStart = getSessionStart(l.createdAtDate);
        l.isPooled = l.sessionStart.getHours() === 10 && l.sessionStart.getMinutes() === 0;
    });

    // Sort by createdAt to ensure FIFO staggering
    leads.sort((a, b) => a.createdAtDate - b.createdAtDate);

    // Calculate effective alert time for each lead
    // For Pooled leads (overnight/weekend), we stagger by 5-minute increments
    const sessionPoolCounts = {};

    for (const lead of leads) {
        const sKey = lead.sessionStart.toISOString();
        let effectiveTimerStart = lead.sessionStart;

        if (lead.isPooled) {
            const rank = sessionPoolCounts[sKey] || 0;
            effectiveTimerStart = new Date(lead.sessionStart.getTime() + rank * 5 * 60 * 1000);
            sessionPoolCounts[sKey] = rank + 1;
        }

        const alertDueTime = new Date(effectiveTimerStart.getTime() + 5 * 60 * 1000);

        if (nowIST >= alertDueTime) {
            console.log(`[Urgent Alerts] Alerting for ${lead.name}. Due: ${alertDueTime.toISOString()}, Now: ${nowIST.toISOString()}`);

            const assigneeRaw = lead.followUpAssignee || lead.owner;
            const member = USERS.find(u =>
                u.id === assigneeRaw ||
                u.email === assigneeRaw ||
                u.email?.toLowerCase() === (assigneeRaw || '').toLowerCase() ||
                u.name?.toLowerCase() === (assigneeRaw || '').toLowerCase()
            );
            const ownerName = member ? member.name : (assigneeRaw || 'Unassigned');
            const ownerEmail = member ? member.email : assigneeRaw;

            const alertData = {
                type: 'deadline',
                leadName: lead.name,
                leadPhone: lead.contactPhone || lead.phone,
                project: lead.project || 'New Lead',
                context: `🚨 *URGENT*: Lead not contacted within 5 mins! | Order: ${lead.isPooled ? 'Staggered Pool' : 'Immediate'} | Assigned: ${ownerName}`
            };

            // Notify Dhiraj & Assignee
            console.log(`[Urgent Alerts] 🚨 Alerting Dhiraj and ${ownerName} for Lead: ${lead.name}`);
            await notifyTeamMember('dhiraj@digitalmojo.in', alertData);
            if (ownerEmail && ownerEmail !== 'dhiraj@digitalmojo.in') {
                await notifyTeamMember(ownerEmail, alertData);
            }

            // Mark as sent
            await lead.ref.update({
                urgentAlertSent: true,
                updatedAt: new Date().toISOString()
            });
        }
    }
    return null;
});

/**
 * Triggered when a new lead is added to the 'contacts' collection (usually from a landing page).
 * If the source is 'adcalculator', it creates a new opportunity in the 'opportunities' collection.
 */
exports.onContactCreate = functions.firestore.document('contacts/{contactId}').onCreate(async (snapshot, context) => {
    const contactData = snapshot.data();
    const contactId = context.params.contactId;

    console.log(`[Contact Trigger] New contact created: ${contactId}, Source: ${contactData.source}`);

    // Determine if this should trigger an opportunity
    // We filter for 'adcalculator' as requested, but we can also handle general website leads
    const isAdCalculator = contactData.source === 'adcalculator' ||
        (contactData.website && contactData.website.includes('adcalculator.digitalmojo.in'));

    if (!isAdCalculator) {
        console.log(`[Contact Trigger] Skipping - Not an adcalculator lead.`);
        return null;
    }

    try {
        const db = getDb();
        // 1. Round-Robin Assignment (Rupal vs Veda)
        const { name: assignedName, email: assignedTo } = await getNextAssignee();

        // 2. Map lead fields
        const displayLeadName = contactData.name || 'Website Lead';
        const phone = contactData.phone || contactData.mobile || '';

        const opportunityData = {
            name: contactData.company || displayLeadName,
            contactId: contactId,
            contactName: displayLeadName,
            contactPhone: phone,
            contactEmail: contactData.email || '',
            phone: phone,
            value: 0,
            companyName: contactData.company || '',
            your_website: contactData.website || '',
            source: 'Landing Page',
            utm_source: contactData.utm_source || '',
            utm_medium: contactData.utm_medium || '',
            utm_campaign: contactData.utm_campaign || '',
            opportunityType: 'adcalculator',
            stage: '16', // 'Yet to contact'
            status: 'Open',
            owner: assignedTo,
            followUpAssignee: assignedTo,
            urgentAlertSent: false,
            tags: ['adcalculator'],
            tasks: [],
            notes: [
                {
                    id: Date.now().toString(),
                    content: `Lead captured from Ad Calculator landing page. Form details: Name: ${displayLeadName}, Phone: ${phone}, Email: ${contactData.email || 'N/A'}, Website: ${contactData.website || 'N/A'}`,
                    createdAt: new Date().toISOString()
                }
            ],
            followUpDate: '',
            followUpRead: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            activities: [{
                id: Date.now().toString(),
                type: 'status_change',
                description: `Opportunity created automatically from Ad Calculator landing page`,
                timestamp: new Date().toISOString(),
                userName: 'Website Automation'
            }]
        };

        const oppRef = await db.collection('opportunities').add(opportunityData);
        console.log(`[Contact Trigger] ✅ Created opportunity ${oppRef.id} for ${displayLeadName} (Assigned to: ${assignedName})`);

    } catch (error) {
        console.error(`[Contact Trigger] Error processing contact ${contactId}:`, error.message);
    }

    return null;
});

/**
 * Triggered when a new lead is added directly to the 'opportunities' collection (Direct Ingestion).
 * This bypasses the 'contacts' collection for improved performance and structure.
 */
exports.onOpportunityCreate = functions.firestore.document('opportunities/{opportunityId}').onCreate(async (snapshot, context) => {
    const data = snapshot.data();
    const opportunityId = context.params.opportunityId;
    let assignedName = 'Our team';
    let ownerEmail = data.owner;

    try {
        // 1. Handle Auto-Assignment if missing
        if (!ownerEmail || ownerEmail === '') {
            console.log(`[Opportunity Trigger] Handling unassigned lead: ${opportunityId}`);
            const { name, email } = await getNextAssignee();
            assignedName = name;
            ownerEmail = email;

            await snapshot.ref.update({
                owner: email,
                followUpAssignee: email,
                assignmentNotified: false, // Picked up by deadlineAlerts cron job
                updatedAt: new Date().toISOString()
            });
            console.log(`[Opportunity Trigger] ✅ Auto-assigned ${opportunityId} to ${name}`);
        } else {
            // Find assigned name for the existing owner
            const user = USERS.find(u => u.email.toLowerCase() === ownerEmail.toLowerCase());
            if (user) assignedName = user.name;
        }

        // 2. Trigger Welcome & Assets Sequence
        const phone = data.phone || data.contactPhone;
        if (phone && !data.isAIPending) {
            // We use a slight delay to ensure Firestore document is fully propagate/available
            // although in onCreate it should be fine.
            await sendLeadWelcomeSequence(phone, data.contactName || data.name, assignedName, opportunityId);
        } else if (data.isAIPending) {
            console.log(`[Opportunity Trigger] ⏸️ Skipping Wati Welcome Sequence for ${opportunityId} (AI Pending)`);
        }

    } catch (error) {
        console.error(`[Opportunity Trigger] Error processing ${opportunityId}:`, error.message);
    }
    return null;
});

/**
 * Periodically syncs call logs from Salestrail Pull API.
 * Matches calls to opportunities by phone number and updates the calls array.
 */
/**
 * Shared helper to perform the Salestrail sync
 */
async function performSalestrailSync(customStartTime = null) {
    console.log('[Salestrail Sync] Starting synchronization...');
    const db = getDb();
    const axios = require('axios');
    const configRef = db.collection('config').doc('salestrail');

    try {
        const configSnap = await configRef.get();
        const lastSyncDetails = configSnap.exists ? configSnap.data() : {};

        // 1. Fetch Calls from Salestrail
        // If deep sync is requested, look back 7 days
        const defaultLookback = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 mins back
        const fromTime = customStartTime || lastSyncDetails.lastSyncTime || '2026-01-01T00:00:00Z';
        const toTime = new Date().toISOString();

        console.log(`[Salestrail Sync] Fetching calls from ${fromTime} to ${toTime}...`);

        const response = await axios.get(`${SALESTRAIL_BASE_URL}/export/calls/byCreated/json`, {
            params: {
                from: fromTime,
                to: toTime
            },
            headers: {
                'Authorization': SALESTRAIL_AUTH,
                'accept': 'application/json'
            }
        });

        const calls = response.data;
        if (!Array.isArray(calls)) {
            console.error('[Salestrail Sync] Unexpected API response format:', typeof calls);
            return { success: false, error: 'Invalid API response' };
        }

        console.log(`[Salestrail Sync] API returned ${calls.length} records.`);

        // OPTIMIZATION: Fetch ALL opportunities for matching to ensure records in all stages (Luke Warm, etc.) are updated.
        const opportunitiesSnapshot = await db.collection('opportunities').get();

        console.log(`[Salestrail Sync] Loaded ${opportunitiesSnapshot.size} total opportunities for matching.`);

        const oppMap = new Map();
        opportunitiesSnapshot.docs.forEach(doc => {
            const data = doc.data();

            // Collect all unique phone numbers for this lead
            const numbers = new Set();
            if (data.phone) numbers.add(normalizePhone(data.phone));
            if (data.contactPhone) numbers.add(normalizePhone(data.contactPhone));
            if (Array.isArray(data.secondaryPhones)) {
                data.secondaryPhones.forEach(p => {
                    const norm = normalizePhone(p);
                    if (norm) numbers.add(norm);
                });
            }

            numbers.forEach(num => {
                if (num) {
                    if (!oppMap.has(num)) oppMap.set(num, []);
                    oppMap.get(num).push(doc);
                }
            });
        });

        let matchCount = 0;
        let updatedCount = 0;
        const updatePromises = [];

        for (const callRecord of calls) {
            const rawPhone = callRecord.number || callRecord.formattedNumber || '';
            const normalizedPhone = normalizePhone(rawPhone);

            if (!normalizedPhone) continue;

            // In-memory lookup: Much faster than Firestore queries in a loop
            const docs = oppMap.get(normalizedPhone);
            if (!docs || docs.length === 0) continue;

            matchCount++;

            // Calculate Status: "Missed Call", "Not Answered", or "Completed"
            let callStatus = "Completed";
            if (callRecord.answered === false) {
                callStatus = callRecord.inbound ? "Missed Call" : "Not Answered";
            }

            let finalizedDuration = callRecord.duration || 0;
            const callSource = callRecord.sourceDetail || '';
            const recUrl = callRecord.recUrl ||
                callRecord.recordingUrl ||
                callRecord.recording_url ||
                (callRecord.recordingAvailable ? `https://standalone-api.salestrail.io/export/calls/${callRecord.callId}/recording` : '');

            // CRITICAL FIX: If a recording is present, extract the true duration from the recording file.
            // This bypasses astronomical session durations reported by the Salestrail API (e.g. 23 hours).
            if (recUrl) {
                const trueDuration = await getTrueDuration(recUrl, SALESTRAIL_AUTH);
                if (trueDuration !== null) {
                    finalizedDuration = trueDuration;
                }
            } else if (callSource === 'WhatsApp' && finalizedDuration > 172800) {
                console.log(`[Salestrail Sync] Capping outlier WhatsApp call ${callRecord.callId} (${finalizedDuration}s -> 0s)`);
                finalizedDuration = 0;
            }

            const callData = {
                id: callRecord.callId,
                duration: finalizedDuration,
                startTime: callRecord.startTime,
                userName: callRecord.userName || 'Unknown',
                answered: callRecord.answered === true,
                type: callRecord.inbound ? 'Incoming' : 'Outgoing',
                status: callStatus,
                source: callSource,
                recordingUrl: recUrl
            };

            for (const doc of docs) {
                const opp = doc.data();
                const existingCalls = opp.calls || [];

                const callIndex = existingCalls.findIndex(c => c.id === callData.id);

                if (callIndex === -1) {
                    // New call: Add to array
                    updatePromises.push(
                        doc.ref.update({
                            calls: admin.firestore.FieldValue.arrayUnion(callData),
                            updatedAt: new Date().toISOString()
                        })
                    );
                    updatedCount++;
                } else {
                    // Check if we need to update status, recordingUrl, or duration for existing calls
                    const existingCall = existingCalls[callIndex];
                    let needsUpdate = false;
                    const updatedCall = { ...existingCall };

                    if (callData.recordingUrl && !existingCall.recordingUrl) {
                        updatedCall.recordingUrl = callData.recordingUrl;
                        needsUpdate = true;
                    }

                    // Log every match for debugging
                    console.log(`[Salestrail Sync] Call Match: ${callData.id} | Salestrail: ${callData.duration}s | CRM: ${existingCall.duration || 0}s`);

                    // Update duration if Salestrail provided a longer one (common for delayed sync or recordings)
                    if (callData.duration > (existingCall.duration || 0)) {
                        updatedCall.duration = callData.duration;
                        console.log(`[Salestrail Sync] UPDATING duration for call ${callData.id}: ${existingCall.duration}s -> ${callData.duration}s`);
                        needsUpdate = true;
                    }

                    if (!existingCall.status || (existingCall.status === 'Completed' && callData.status !== 'Completed')) {
                        updatedCall.status = callStatus;
                        needsUpdate = true;
                    }

                    if (needsUpdate) {
                        const updatedCalls = [...existingCalls];
                        updatedCalls[callIndex] = updatedCall;

                        updatePromises.push(
                            doc.ref.update({
                                calls: updatedCalls,
                                updatedAt: new Date().toISOString()
                            })
                        );
                        updatedCount++;
                    }
                }
            }

            // Execute in batches of 20 to avoid rate limits
            if (updatePromises.length >= 20) {
                await Promise.all(updatePromises);
                updatePromises.length = 0;
            }
        }

        // Catch remaining updates
        if (updatePromises.length > 0) {
            await Promise.all(updatePromises);
        }


        console.log(`[Salestrail Sync] COMPLETED. Matches: ${matchCount}, New/Updated entries: ${updatedCount}`);

        await configRef.set({
            lastSyncTime: toTime,
            lastUpdatedCount: updatedCount,
            lastStatus: 'success',
            lastRun: new Date().toISOString()
        }, { merge: true });

        // SKIP Phase 2 backfill to save time
        console.log('[Salestrail Sync] Skipping mass backfill for speed.');

        // Phase 3: AI Analysis (PROCESS MULTIPLE)
        console.log('[Salestrail Sync] Scanning recent leads (500) for recordings needing analysis...');
        const recentSnapshot = await db.collection('opportunities')
            .orderBy('updatedAt', 'desc')
            .limit(500)
            .get();

        let analyzedInThisRun = 0;
        const MAX_PER_RUN = 10; // Process up to 10 recordings per 1-min run to stay safe

        for (const doc of recentSnapshot.docs) {
            if (analyzedInThisRun >= MAX_PER_RUN) break;

            const oppData = doc.data();
            const calls = oppData.calls || [];
            let updated = false;

            for (let i = calls.length - 1; i >= 0; i--) {
                const call = calls[i];
                const callDate = new Date(call.startTime);
                // Auto-analyze calls from the last 48 hours only
                const autoTriggerDate = new Date(Date.now() - 48 * 60 * 60 * 1000);

                if (call.recordingUrl && !call.aiAnalysis && callDate >= autoTriggerDate) {
                    const lockRef = db.collection('ai_processing_locks').doc(String(call.id));

                    try {
                        // Check if another run is already processing this call
                        try {
                            // Use ref.create to atomically check-and-create the lock.
                            // This fails if the document already exists, preventing race conditions.
                            await lockRef.create({
                                leadName: oppData.name,
                                timestamp: admin.firestore.FieldValue.serverTimestamp()
                            });
                        } catch (e) {
                            // If creation fails, check if the existing lock is stale (older than 10 mins)
                            const lockDoc = await lockRef.get();
                            if (lockDoc.exists) {
                                const lockData = lockDoc.data();
                                const lockAge = Date.now() - (lockData.timestamp?.toDate().getTime() || 0);

                                if (lockAge < 10 * 60 * 1000) {
                                    console.log(`[Salestrail Sync] 🔒 Skipping call ${call.id} for ${oppData.name} - already being processed.`);
                                    continue;
                                } else {
                                    // Overwrite stale lock
                                    await lockRef.set({
                                        leadName: oppData.name,
                                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                                    });
                                }
                            }
                        }

                        console.log(`[Salestrail Sync] 🎯 Analyzing call for ${oppData.name} (${analyzedInThisRun + 1}/${MAX_PER_RUN})...`);

                        const analysis = await analyzeCallWithGemini(call.recordingUrl, oppData.name);

                        if (analysis) {
                            calls[i].aiAnalysis = analysis;
                            updated = true;
                            analyzedInThisRun++;

                            await db.collection('system_logs').add({
                                type: 'ai_analysis_success',
                                leadName: oppData.name,
                                callId: call.id,
                                rating: analysis.rating,
                                timestamp: admin.firestore.FieldValue.serverTimestamp()
                            });

                            // Real-time Notification to Dhiraj
                            await notifyDhirajAboutCallAnalysis(oppData.name, analysis, call.userName || 'Unknown User');

                            // Cleanup lock
                            await lockRef.delete();

                            // Delay 5s to stay under Gemini RPM quota
                            if (analyzedInThisRun < MAX_PER_RUN) {
                                await new Promise(r => setTimeout(r, 5000));
                            }
                            break; // Move to next lead
                        }
                    } catch (err) {
                        console.error(`[Salestrail Sync] AI Failed for ${oppData.name}:`, err.message);
                        // Ensure lock is released on error so it can be retried in next run
                        await lockRef.delete().catch(() => { });
                    }
                }
            }

            if (updated) {
                await doc.ref.update({ calls });
            }
        }

        return { success: true, matches: matchCount, updated: updatedCount, analyzed: analyzedInThisRun };

    } catch (error) {
        console.error('[Salestrail Sync] FATAL ERROR:', error.response?.data || error.message);
        await configRef.set({
            lastStatus: 'error',
            lastError: error.message,
            lastRun: new Date().toISOString()
        }, { merge: true });
        return { success: false, error: error.message };
    }
}

/**
 * Backfill existing data:
 * 1. Normalize all primary phones
 * 2. Initialize and normalize secondaryPhones
 * 3. Update all historical calls with appropriate statuses
 */
exports.backfillData = functions.runWith({
    timeoutSeconds: 540,
    memory: '1GB'
}).https.onRequest(async (req, res) => {
    console.log('[Backfill] Starting data normalization backfill...');
    const db = getDb();

    try {
        const snapshot = await db.collection('opportunities').get();
        let count = 0;
        let batch = db.batch();
        const results = { total: snapshot.size, updated: 0 };

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const updates = {};

            // 1. Normalize phone fields
            const normPhone = normalizePhone(data.phone);
            if (normPhone && normPhone !== data.phone) {
                updates.phone = normPhone;
            }

            if (normPhone && normPhone !== data.phone_whatsapp_normalized) {
                updates.phone_whatsapp_normalized = normPhone;
            }

            const normContactPhone = normalizePhone(data.contactPhone);
            if (normContactPhone && normContactPhone !== data.contactPhone) {
                updates.contactPhone = normContactPhone;
            }

            // 2. Normalize secondary phones
            const secondary = data.secondaryPhones || [];
            const normSecondary = secondary.map(p => normalizePhone(p)).filter(p => p && p !== (updates.phone || data.phone));

            // Deduplicate secondary numbers
            const uniqueSecondary = [...new Set(normSecondary)];

            if (JSON.stringify(uniqueSecondary) !== JSON.stringify(secondary) || !data.secondaryPhones) {
                updates.secondaryPhones = uniqueSecondary;
            }

            // 3. Update call statuses & durations
            if (data.calls && Array.isArray(data.calls)) {
                let callUpdated = false;
                const updatedCalls = data.calls.map(call => {
                    let c = { ...call };
                    let changed = false;

                    // Fix missing status
                    if (!c.status) {
                        c.status = (c.answered === false) ? (c.type === 'Incoming' ? 'Missed Call' : 'Not Answered') : 'Completed';
                        changed = true;
                    }

                    // Fix erroneous duration: WhatsApp calls > 1 hour are session bugs
                    const durationNum = Number(c.duration || 0);
                    const sourceLower = (c.source || '').toLowerCase();

                    // If duration is > 1 hour and it's WhatsApp (or unknown), it's a bug
                    if ((sourceLower === 'whatsapp' || !c.source || sourceLower === '') && durationNum > 3600) {
                        c.duration = 0;
                        changed = true;
                        console.log(`[Backfill] Fixed outlier duration for lead ${data.name}: ${call.duration}s -> 0s (Call ID: ${c.id})`);
                    }

                    if (changed) callUpdated = true;
                    return c;
                });

                if (callUpdated) {
                    updates.calls = updatedCalls;
                }
            }

            if (Object.keys(updates).length > 0) {
                batch.update(doc.ref, {
                    ...updates,
                    updatedAt: new Date().toISOString()
                });
                results.updated++;
                count++;
            }

            if (count >= 400) {
                await batch.commit();
                batch = db.batch();
                count = 0;
            }
        }

        if (count > 0) {
            await batch.commit();
        }

        // 4. Trigger Deep Sync (30 days back) for absolute historical reconciliation
        console.log('[Backfill] Triggering Deep Sync (30 days lookback)...');
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const syncResult = await performSalestrailSync(thirtyDaysAgo);
        results.deepSync = syncResult;

        res.json({ success: true, results });
    } catch (error) {
        console.error('[Backfill] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * META ADS WEBHOOK: Verification & Ingestion
 */
exports.metaWebhook = functions.https.onRequest(async (req, res) => {
    const db = getDb();

    // 1. Verification (GET)
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (mode === 'subscribe' && token === 'dm_meta_verify_2026') {
            console.log('[Meta Webhook] Verification successful.');
            return res.status(200).send(challenge);
        }
        return res.status(403).send('Forbidden');
    }

    // 2. Lead Ingestion (POST)
    if (req.method === 'POST') {
        const axios = require('axios');
        try {
            const entry = req.body.entry?.[0];
            const changes = entry?.changes?.[0];
            const leadId = changes?.value?.leadgen_id;

            console.log(`[Meta Webhook] Received POST Payload:`, JSON.stringify(req.body));

            if (!leadId) {
                console.warn(`[Meta Webhook] No lead ID found in payload changes. Value:`, JSON.stringify(changes?.value));
                return res.status(200).send('No lead ID found');
            }

            console.log(`[Meta Webhook] Processing Lead ID: ${leadId}`);

            // 3. Fetch Lead Details from Meta Graph API
            let leadData = null;
            try {
                const graphUrl = `https://graph.facebook.com/v22.0/${leadId}?access_token=${META_ACCESS_TOKEN}`;
                const leadResponse = await axios.get(graphUrl);
                leadData = leadResponse.data;
                console.log(`[Meta Webhook] Successfully fetched lead details for ${leadId}`);
            } catch (graphError) {
                console.error(`[Meta Webhook] Failed to fetch Graph API data for ${leadId}:`, graphError.response?.data || graphError.message);
                // We proceed with placeholder if Graph API fails
            }

            const fieldData = leadData?.field_data || [];
            const getField = (name) => fieldData.find(f => f.name === name)?.values?.[0] || null;

            // Map Meta Fields to CRM Structure
            const fullName = getField('full_name') || 'Meta Ads Lead';
            const rawPhone = getField('phone_number') || '';
            const normalizedPhone = normalizePhone(rawPhone);
            const email = getField('work_email') || '';
            const dob = getField('date_of_birth') || '';
            const budget = getField('what_is_your_current_monthly_ad_spend?') || '';
            const propertyType = getField('property_type?') || '';
            const projectLocation = getField('where_is_your_project_located?') || '';
            const website = getField('share_your_project_website.') || '';
            const unitsLeft = getField('how_many_units_are_left_to_sell_in_your_project') || '';

            // Dedup check
            if (normalizedPhone) {
                const existing = await db.collection('opportunities')
                    .where('phone', '==', normalizedPhone)
                    .limit(1)
                    .get();
                if (!existing.empty) {
                    console.log(`[Meta Webhook] Skip - Duplicate lead found for ${normalizedPhone}`);
                    return res.status(200).send('Duplicate Skipped');
                }
            }

            // Round-Robin Assignment
            const { name: assignedName, email: assignedTo } = await getNextAssignee();

            const opportunityData = {
                name: fullName,
                contactName: fullName,
                contactPhone: normalizedPhone,
                contactEmail: email,
                phone: normalizedPhone,
                value: 0, // Initial value
                source: 'Meta Ads',
                opportunityType: 'Meta Ads',
                stage: '16',
                status: 'Open',
                owner: assignedTo,
                followUpAssignee: assignedTo,
                monthlyBudget: budget,
                propertyType: propertyType,
                projectLocation: projectLocation,
                your_website: website,
                unitsLeft: unitsLeft,
                urgentAlertSent: false,
                assignmentNotified: false,
                redFlagSent: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                notes: [{
                    id: Date.now().toString(),
                    content: `Lead captured via Meta Ads.\nLead ID: ${leadId}\nDOB: ${dob}\nBudget: ${budget}\nUnits Left: ${unitsLeft}\nWebsite: ${website}`,
                    createdAt: new Date().toISOString()
                }],
                activities: [{
                    id: Date.now().toString(),
                    type: 'status_change',
                    description: `New Meta Lead assigned to ${assignedName}`,
                    timestamp: new Date().toISOString(),
                    userName: 'Meta Automation'
                }]
            };

            const docRef = await db.collection('opportunities').add(opportunityData);
            console.log(`[Meta Webhook] ✅ Lead created: ${docRef.id} for ${fullName} -> assigned to ${assignedName}`);

            // Notify Assignee
            try {
                await notifyTeamMember(assignedTo, {
                    type: 'assignment',
                    leadName: fullName,
                    leadPhone: normalizedPhone,
                    project: 'Meta Ads',
                    context: `New Meta Lead generated.\nBudget: ${budget}\nLocation: ${projectLocation}`
                });
            } catch (notifyErr) {
                console.error('[Meta Webhook] Notification failed:', notifyErr.message);
            }

            return res.status(200).send('Lead Recorded Successfully');
        } catch (error) {
            console.error('[Meta Webhook] Critical Error:', error.message);
            return res.status(200).send('Error Acknowledged');
        }
    }

    return res.status(405).send('Method Not Allowed');
});

/**
 * Discovery Form Webhook (Google Forms)
 */
exports.discoveryWebhook = functions.https.onRequest(async (req, res) => {
    const db = getDb();
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    try {
        const { phone, responses, submittedAt } = req.body;

        if (!phone) {
            console.error('[Discovery Webhook] Missing phone number');
            return res.status(400).send('Missing phone');
        }

        const normalizedPhone = normalizePhone(phone);
        const docId = `${normalizedPhone}_${Date.now()}`;

        await db.collection('discovery_responses').doc(docId).set({
            phone: normalizedPhone,
            submittedAt: submittedAt || new Date().toISOString(),
            responses: responses || {},
            createdAt: new Date().toISOString()
        });

        console.log(`[Discovery Webhook] Saved response for ${normalizedPhone}`);
        res.status(200).send({ success: true, id: docId });
    } catch (error) {
        console.error('[Discovery Webhook] Error:', error);
        res.status(500).send(error.message);
    }
});

/**
 * Periodic sync (Automatic)
 */
exports.syncSalestrailCalls = functions.runWith({
    timeoutSeconds: 540,
    memory: '1GB'
}).pubsub.schedule('every 1 minutes').onRun(async (context) => {
    await performSalestrailSync();
    return null;
});

/**
 * Manual sync trigger (Callable)
 * Increased timeout to 540s for large catch-up runs
 */
exports.manualSalestrailSync = functions.runWith({
    timeoutSeconds: 540,
    memory: '1GB'
}).https.onCall(async (data, context) => {
    console.log('[Salestrail Sync] Manual trigger received via onCall.');

    // Optional: Check authentication
    /*
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    */

    // Manual sync looks back 48 hours by default to recover missing records
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const result = await performSalestrailSync(fortyEightHoursAgo);
    return result;
});

/**
 * Identify and report "Red Flags" among open leads.
 * Red Flag Conditions:
 * 1. Follow-up date is not set in monitored stages.
 * 2. Lead stays in 'Yet to Contact' (stage 16) for > 2 hours.
 */
async function generateRedFlagReport() {
    const db = admin.firestore();
    const axios = require('axios');
    const snapshot = await db.collection('opportunities')
        .where('status', '==', 'Open')
        .get();

    const now = new Date();
    const redFlags = [];

    snapshot.docs.forEach(doc => {
        const lead = doc.data();
        const stage = String(lead.stage || '');
        const hasOwner = !!lead.owner && String(lead.owner).trim() !== '';

        if (RED_OWNER_REQUIRED && !hasOwner) return;

        if (RED_FLAG_STAGES.includes(stage)) {
            let reasons = [];

            // Condition 1: Follow-up date not set
            if (!lead.followUpDate || String(lead.followUpDate).trim() === '') {
                reasons.push("Follow-up date not set");
            }

            // Condition 2: In stage '16' for > 2 hours since creation
            if (stage === '16') {
                const createdAt = lead.createdAt ? new Date(lead.createdAt) : null;
                if (createdAt) {
                    const diffMs = now - createdAt;
                    const diffHrs = diffMs / (1000 * 60 * 60);
                    if (diffHrs > 2) {
                        reasons.push(`${diffHrs.toFixed(1)}hrs in 'Yet to Contact'`);
                    }
                }
            }

            if (reasons.length > 0) {
                redFlags.push({
                    name: lead.name || 'Unnamed Lead',
                    stage: stage,
                    owner: lead.owner || 'Unassigned',
                    reason: reasons.join(' & ')
                });
            }
        }
    });

    if (redFlags.length === 0) {
        return "✅ No Red Flags detected. All active leads are properly scheduled.";
    }

    // Group by owner for clarity - Merging UIDs, Emails, and Names
    const byOwner = {};
    redFlags.forEach(f => {
        const owner = f.owner || 'Unassigned';
        const normalized = owner.trim().toLowerCase();

        const user = USERS.find(u =>
            (u.id && u.id === owner) ||
            (u.email && u.email.toLowerCase() === normalized) ||
            (u.name && u.name.toLowerCase() === normalized)
        );

        const ownerName = user ? user.name : owner;

        if (!byOwner[ownerName]) byOwner[ownerName] = [];
        byOwner[ownerName].push(f);
    });

    let message = `🚨 *RED FLAG REPORT*\nTotal Flags: ${redFlags.length}\n\n`;
    let truncated = false;

    for (const [owner, flags] of Object.entries(byOwner)) {
        let ownerSection = `👤 *${owner}*:\n`;
        for (const f of flags) {
            const line = `- ${f.name} (${f.reason})\n`;
            // Safety check: Don't exceed Wati's 4096 limit
            if ((message.length + ownerSection.length + line.length) > 3800) {
                truncated = true;
                break;
            }
            ownerSection += line;
        }
        message += ownerSection + `\n`;
        if (truncated) break;
    }

    if (truncated) message += `...and more. ⚠️ *Truncated due to length.*\n\n`;
    message += `👉 *View & Fix:* https://crm-digitalmojo.web.app/red-flags`;

    return message;
}

/**
 * Callable function to manually trigger the red flag report to Dhiraj.
 */
exports.sendRedFlagReport = functions.runWith({ timeoutSeconds: 60, memory: '256MB' }).region('us-central1').https.onCall(async (data, context) => {
    // Dhiraj's phone number as specified in requirements
    const dhirajPhone = '919908398763';

    try {
        console.log(`[Red Flags] Generating report for Dhiraj...`);
        const reportBody = await generateRedFlagReport();
        const axios = require('axios');

        console.log(`[Red Flags] Sending report to Wati...`);
        const response = await axios.post(`${WATI_ENDPOINT}/api/v1/sendSessionMessage/${dhirajPhone}?messageText=${encodeURIComponent(reportBody)}`, {}, {
            headers: { Authorization: WATI_TOKEN }
        });

        console.log(`[Red Flags] Wati Response:`, JSON.stringify(response.data));

        if (response.data && response.data.result === false) {
            console.error(`[Red Flags] Wati reported failure:`, response.data.errors || response.data.message);
            return {
                success: false,
                error: response.data.message || 'Wati API returned result: false',
                details: response.data
            };
        }

        console.log(`[Red Flags] Report sent successfully to ${dhirajPhone}.`);
        return { success: true, report: reportBody };
    } catch (error) {
        console.error(`[Red Flags] Failed to send report:`, error.response?.data || error.message);
        throw new functions.https.HttpsError('internal', error.response?.data?.message || error.message);
    }
});

/**
 * Endpoint to check the status of pending call backfills.
 */
exports.getBackfillStatus = functions.runWith({ timeoutSeconds: 60, memory: '256MB' }).region('us-central1').https.onCall(async (data, context) => {
    try {
        const db = admin.firestore();
        const snapshot = await db.collection('opportunities').orderBy('updatedAt', 'desc').limit(500).get();
        let pendingCalls = 0;
        let pendingLeads = 0;

        snapshot.docs.forEach(doc => {
            const lead = doc.data();
            const calls = lead.calls || [];
            let leadHasPending = false;
            for (const call of calls) {
                if (!call.startTime) continue;

                const callDate = new Date(call.startTime);
                const startDate = new Date('2026-04-01T00:00:00Z');
                const endDate = new Date('2026-04-22T00:00:00Z'); // up to today

                if (call.recordingUrl && !call.aiAnalysis && callDate >= startDate && callDate < endDate) {
                    pendingCalls++;
                    leadHasPending = true;
                }
            }
            if (leadHasPending) pendingLeads++;
        });

        return { pendingCalls, pendingLeads, scannedLeads: snapshot.size };
    } catch (error) {
        console.error("Failed to get backfill status:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

/**
 * Endpoint to safely backfill a small batch of calls
 */
exports.aiBackfillBatch = functions.runWith({ timeoutSeconds: 540, memory: '1GB' }).region('us-central1').https.onCall(async (data, context) => {
    try {
        const db = admin.firestore();
        // Limit small batch size to stay well under cloud function 540s timeout and Gemini 15RPM limit
        const batchSize = data.batchSize || 3;

        console.log(`[AI Backfill] Processing batch of up to ${batchSize} opportunities...`);

        // Get leads with most recently updated first to match prioritization
        const snapshot = await db.collection('opportunities').orderBy('updatedAt', 'desc').limit(500).get();

        let totalProcessedCalls = 0;
        let processedLeads = 0;
        let totalSuccessCalls = 0;
        let errors = [];

        for (const doc of snapshot.docs) {
            if (processedLeads >= batchSize) break;

            const lead = doc.data();
            const calls = lead.calls || [];

            let leadNeedsUpdate = false;
            const updatedCalls = [...calls];
            let hasPendingCallsInLead = false;

            for (let i = 0; i < updatedCalls.length; i++) {
                const call = updatedCalls[i];
                if (!call.startTime) continue;

                const callDate = new Date(call.startTime);
                const startDate = new Date('2026-04-01T00:00:00Z');
                const endDate = new Date('2026-04-22T00:00:00Z');

                if (call.recordingUrl && !call.aiAnalysis && callDate >= startDate && callDate < endDate) {
                    hasPendingCallsInLead = true;
                    try {
                        const analysis = await analyzeCallWithGemini(call.recordingUrl, lead.name || 'Unknown');
                        if (analysis) {
                            updatedCalls[i] = { ...call, aiAnalysis: analysis };
                            leadNeedsUpdate = true;
                            totalSuccessCalls++;
                            console.log(`[AI Backfill] Success for ${lead.name}`);
                        } else {
                            errors.push(`Analysis returned null for a call in ${lead.name}`);
                        }
                    } catch (err) {
                        errors.push(`Error analyzing call in ${lead.name}: ${err.message}`);
                    }
                    totalProcessedCalls++;

                    // Simple rate limiting: wait 15 seconds after hitting Gemini (4 calls / min)
                    // Even if analysis failed, rate limits could still trigger.
                    await new Promise(r => setTimeout(r, 15000));
                }
            }

            if (leadNeedsUpdate) {
                await doc.ref.update({
                    calls: updatedCalls,
                    updatedAt: new Date().toISOString()
                });
            }

            if (hasPendingCallsInLead) {
                processedLeads++;
            }
        }

        return {
            success: true,
            processedLeads,
            totalProcessedCalls,
            totalSuccessCalls,
            errors
        };

    } catch (error) {
        console.error("[AI Backfill] Batch Failed:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

/**
 * ONE-TIME FIX: Backfills the urgentAlertSent field for all historical leads
 * so they are picked up by the 5-minute scheduler.
 */
exports.fixUrgentLeadsBackfill = functions.https.onRequest(async (req, res) => {
    try {
        const db = getDb();
        const snapshot = await db.collection('opportunities')
            .where('status', '==', 'Open')
            .where('stage', '==', '16')
            .get();

        let updated = 0;
        const promises = [];

        snapshot.docs.forEach(doc => {
            // Reset urgentAlertSent for ALL Stage 16 leads, even if calls were made.
            // This ensures logic changes (like template formatting) are reapplied to stagnant leads.
            promises.push(doc.ref.update({
                urgentAlertSent: false,
                updatedAt: new Date().toISOString()
            }));
            updated++;
        });

        await Promise.all(promises);
        res.status(200).send(`Backfill complete. Updated ${updated} leads.`);
    } catch (error) {
        res.status(500).send(`Error: ${error.message}`);
    }
});

/**
 * TEST: Resends today's call analytics notifications to Dhiraj.
 * Use this to verify that WhatsApp notifications are firing correctly.
 */
exports.testSendTodaysAnalytics = functions.https.onRequest(async (req, res) => {
    try {
        const db = getDb();
        const now = new Date();
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        console.log(`[Test Analytics] Fetching analytics since ${startOfToday.toISOString()}...`);

        const logsSnapshot = await db.collection('system_logs')
            .where('type', '==', 'ai_analysis_success')
            .get();

        const todaysLogs = logsSnapshot.docs.filter(doc => {
            const data = doc.data();
            if (!data.timestamp) return false;
            // Handle both Firestore Timestamp and potential Date strings
            const logTime = data.timestamp.toDate ? data.timestamp.toDate() : new Date(data.timestamp);
            return logTime >= startOfToday;
        });

        if (todaysLogs.length === 0) {
            return res.send("No call analytics logs found for today.");
        }

        let sentCount = 0;
        const processedLeads = new Set();

        for (const logDoc of todaysLogs) {
            const logData = logDoc.data();
            const leadName = logData.leadName;
            const callId = logData.callId;

            // Find the lead to get the full analysis
            const oppSnapshot = await db.collection('opportunities')
                .where('name', '==', leadName)
                .get();

            for (const oppDoc of oppSnapshot.docs) {
                const oppData = oppDoc.data();
                const call = oppData.calls?.find(c => c.id === callId);

                if (call && call.aiAnalysis) {
                    const key = `${leadName}_${callId}`;
                    if (!processedLeads.has(key)) {
                        await notifyDhirajAboutCallAnalysis(oppData.name, call.aiAnalysis, call.userName || 'Unknown User');
                        processedLeads.add(key);
                        sentCount++;
                    }
                }
            }
        }

        res.status(200).send(`Test complete. Successfully resent ${sentCount} notifications to Dhiraj.`);
    } catch (error) {
        console.error(`[Test Analytics] Error:`, error.message);
        res.status(500).send(`Error: ${error.message}`);
    }
});

/**
 * Sends a sequence of sales assets (2 PDFs + Discovery Form) to a lead.
 */
exports.sendSalesAssets = functions.https.onCall(async (data, context) => {
    // Check authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    let { leadId, opportunityId, phone } = data;
    const finalLeadId = leadId || opportunityId;

    if (!finalLeadId) {
        throw new functions.https.HttpsError('invalid-argument', 'The function must be called with a "leadId" or "opportunityId".');
    }

    const db = getDb();

    // Fetch phone from Firestore if not provided in the request
    if (!phone) {
        console.log(`[Sales Assets] Phone missing in request for lead ${finalLeadId}, fetching from Firestore...`);
        const leadDoc = await db.collection('opportunities').doc(finalLeadId).get();
        if (!leadDoc.exists) {
            throw new functions.https.HttpsError('not-found', `Lead/Opportunity with ID ${finalLeadId} not found.`);
        }
        const leadData = leadDoc.data();
        phone = leadData.phone || leadData.contactPhone;

        if (!phone) {
            throw new functions.https.HttpsError('invalid-argument', 'The identified lead does not have a valid phone number.');
        }
        console.log(`[Sales Assets] Found phone: ${phone} for lead: ${leadData.name}`);
    }

    try {
        // Normalize phone
        const cleanPhone = phone.replace(/\D/g, '');

        // Fetch Lead Details for names
        const leadDoc = await db.collection('opportunities').doc(finalLeadId).get();
        const leadData = leadDoc.data() || {};

        // Find assigned name
        let assignedName = 'Our team';
        const ownerEmail = leadData.owner;
        if (ownerEmail) {
            const user = USERS.find(u => u.email.toLowerCase() === ownerEmail.toLowerCase());
            if (user) assignedName = user.name;
        }

        // Use the common sequence helper
        await sendLeadWelcomeSequence(cleanPhone, leadData.contactName || leadData.name, assignedName, finalLeadId);

        // Log the action in system_logs
        await db.collection('system_logs').add({
            type: 'send_sales_assets',
            leadId: finalLeadId,
            phone: cleanPhone,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            userEmail: context.auth.token.email,
            userName: context.auth.token.name || 'Unknown'
        });

        return { success: true };

    } catch (error) {
        console.error('[Sales Assets] Error:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

// Export Huskyvoice integrations
exports.huskyvoiceWebhook = huskyvoiceWebhook;
exports.processPendingAICalls = processPendingAICalls;

// Export helpers for use in other modules
exports.sendLeadWelcomeSequence = sendLeadWelcomeSequence;
exports.USERS = USERS;

