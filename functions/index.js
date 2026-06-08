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
const RESEND_API_KEY = process.env.RESEND_API_KEY;
let resend;
if (RESEND_API_KEY) {
    const { Resend } = require('resend');
    resend = new Resend(RESEND_API_KEY);
}

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
        summary: analysis.summary || 'No summary provided.',
        goodFeatures: analysis.goodFeatures || [],
        improvements: analysis.improvements || []
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
    return cleaned;
}

/**
 * Generates an array of phone variants (full and 10-digit legacy) 
 * for robust database querying and deduplication.
 */
function getPhoneVariants(phone) {
    if (!phone) return [''];
    const cleaned = String(phone).replace(/\D/g, '');
    if (cleaned.length >= 10) {
        return Array.from(new Set([cleaned, cleaned.slice(-10)]));
    }
    return [cleaned];
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
 * Calculates effective time in milliseconds elapsed between startMs and endMs,
 * skipping any time that falls on a Sunday in IST.
 */
function getEffectiveTimeMs(startMs, endMs) {
    if (startMs >= endMs) return 0;
    
    let totalMs = endMs - startMs;
    let sundayMs = 0;
    
    // Offset for IST is +5h 30m
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const startIST = startMs + IST_OFFSET;
    const endIST = endMs + IST_OFFSET;
    
    let currentDayIST = new Date(startIST);
    currentDayIST.setUTCHours(0, 0, 0, 0); // Start of the IST day
    
    while (currentDayIST.getTime() <= endIST) {
        if (currentDayIST.getUTCDay() === 0) { // Sunday
            const sundayStart = currentDayIST.getTime();
            const sundayEnd = sundayStart + 24 * 60 * 60 * 1000;
            
            const overlapStart = Math.max(startIST, sundayStart);
            const overlapEnd = Math.min(endIST, sundayEnd);
            
            if (overlapStart < overlapEnd) {
                sundayMs += (overlapEnd - overlapStart);
            }
        }
        currentDayIST.setUTCDate(currentDayIST.getUTCDate() + 1);
    }
    
    return totalMs - sundayMs;
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

            let text = `📊 *AI Call Analysis*\n\nLead: ${displayLeadName}\nUser: ${messageData.callUser}\nRating: ${messageData.rating}/10\n\nReview: ${messageData.summary}`;
            
            if (messageData.goodFeatures && messageData.goodFeatures.length > 0) {
                text += `\n\n✅ *Key Strengths:*\n- ${messageData.goodFeatures.join('\n- ')}`;
            }
            if (messageData.improvements && messageData.improvements.length > 0) {
                text += `\n\n📈 *Areas for Improvement:*\n- ${messageData.improvements.join('\n- ')}`;
            }

            try {
                await sendWatiTemplate(user.phone, templateName, params);
                // Send detailed analysis as a session message after the brief template
                await axios.post(`${WATI_ENDPOINT}/api/v1/sendSessionMessage/${user.phone}?messageText=${encodeURIComponent(text)}`, {}, { headers: { Authorization: WATI_TOKEN } }).catch(() => {});
            } catch (e) {
                console.log(`[Notifications] Analysis template failed for ${user.name}, falling back to session message.`);
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
 * Send email using Resend API.
 * Rules: Automatically include Srishti if sending to Dhiraj, and CC the assignee.
 */
async function sendEmailWithCC(toEmail, subject, htmlContent, assigneeEmail) {
    if (!resend) {
        console.warn(`[Emails] Resend not configured. Would have sent: ${subject}`);
        return;
    }
    
    let toAddresses = [toEmail];
    let ccAddresses = [];
    
    if (toEmail === 'dhiraj@digitalmojo.in') {
        toAddresses.push('srishti@digitalmojo.in');
    }
    
    if (assigneeEmail && !toAddresses.includes(assigneeEmail)) {
        ccAddresses.push(assigneeEmail);
    }
    
    try {
        const result = await resend.emails.send({
            from: 'Mojo CRM <info@digitalmojo.in>',
            to: toAddresses,
            cc: ccAddresses.length > 0 ? ccAddresses : undefined,
            subject: subject,
            html: htmlContent
        });
        console.log(`[Emails] Sent email via Resend: ${result?.id || 'Unknown ID'}`);
        return result;
    } catch (e) {
        console.error(`[Emails] Resend error:`, e.message);
    }
}

/**
 * Helper to generate eye-catching HTML for escalation emails.
 */
function getEscalationEmailHtml(title, leadName, details) {
    return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 2px solid #b71c1c; border-radius: 8px; overflow: hidden; box-shadow: 0 8px 16px rgba(183,28,28,0.2);">
        <div style="background-color: #b71c1c; color: white; padding: 25px; text-align: center; border-bottom: 4px solid #f44336;">
            <h2 style="margin: 0; font-size: 28px; letter-spacing: 2px; text-transform: uppercase; text-shadow: 1px 1px 2px rgba(0,0,0,0.3);">🚨 URGENT ESCALATION 🚨</h2>
            <p style="margin: 10px 0 0 0; font-size: 16px; font-weight: bold; background-color: rgba(255,255,255,0.2); display: inline-block; padding: 5px 15px; border-radius: 20px;">IMMEDIATE ACTION REQUIRED</p>
        </div>
        <div style="padding: 30px; background-color: #ffffff;">
            <h3 style="margin-top: 0; color: #b71c1c; font-size: 22px; border-bottom: 2px solid #ffebee; padding-bottom: 10px;">🛑 ${title}</h3>
            <p style="font-size: 16px; line-height: 1.6; color: #333; font-weight: 500;">
                This is a high-priority automated escalation regarding the lead <strong>${leadName}</strong>. 
                Service level agreements (SLA) have been breached and immediate intervention is necessary.
            </p>
            <div style="background-color: #fff8f8; border: 1px solid #ffcdd2; border-left: 5px solid #b71c1c; padding: 18px; margin: 25px 0; border-radius: 4px;">
                ${details.map(d => `<p style="margin: 8px 0; font-size: 15px; color: #444;"><strong style="color: #000; min-width: 130px; display: inline-block;">${d.label}:</strong> <span style="background-color: #ffebee; padding: 2px 6px; border-radius: 4px; color: #c62828; font-weight: 600;">${d.value}</span></p>`).join('')}
            </div>
            <div style="text-align: center; margin-top: 30px;">
                <a href="https://crm.digitalmojo.in" style="background-color: #d32f2f; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 6px rgba(211,47,47,0.3);">Open Mojo CRM Now</a>
            </div>
            <p style="font-size: 13px; color: #888; margin-top: 30px; text-align: center; border-top: 1px solid #eeeeee; padding-top: 20px;">
                This is an automated system notification from Mojo CRM.<br>
                <em>Please do not reply to this email.</em>
            </p>
        </div>
    </div>
    `;
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
        const senderVariants = getPhoneVariants(senderNumber);

        const isAuthorized = USERS.some(u => {
            const userVariants = getPhoneVariants(u.phone);
            return senderVariants.some(v => userVariants.includes(v));
        });

        if (!isAuthorized) {
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
            const extractedVariants = getPhoneVariants(extracted.phone);
            const normalizedExtractedPhone = normalizePhone(extracted.phone);
            const existingSnapshot = await db.collection('opportunities')
                .where('phone', 'in', extractedVariants)
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
        const phoneVariants = getPhoneVariants(extracted.phone);
        let isTestNumber = false;
        testNumbers.forEach(n => {
            const testVariants = getPhoneVariants(n);
            if (phoneVariants.some(v => testVariants.includes(v))) {
                isTestNumber = true;
            }
        });

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
 * Webhook to receive leads from Meta (Facebook/Instagram Lead Ads).
 */
exports.metaLeadWebhook = functions.runWith({ timeoutSeconds: 60, memory: '256MB' }).region('us-central1').https.onRequest(async (req, res) => {
    const axios = require('axios');
    const db = getDb();
    
    // Webhook verification setup for Meta
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'mojo_meta_webhook_123';

        if (mode && token) {
            if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
                console.log('[Meta Webhook] WEBHOOK_VERIFIED');
                return res.status(200).send(challenge);
            } else {
                return res.sendStatus(403);
            }
        }
        return res.sendStatus(400);
    }

    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    try {
        const payload = req.body;
        console.log(`[Meta Webhook] RAW PAYLOAD: ${JSON.stringify(payload)}`);

        if (payload.object !== 'page') {
            return res.status(404).send('Not Found');
        }

        const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
        if (!META_ACCESS_TOKEN) {
            console.error('[Meta Webhook] META_ACCESS_TOKEN is not set.');
            // Still return 200 so Meta doesn't retry infinitely if we're misconfigured
            return res.status(200).send('Misconfigured');
        }

        // Meta can batch events
        for (const entry of payload.entry) {
            if (!entry.changes) continue;
            
            for (const change of entry.changes) {
                if (change.field !== 'leadgen') continue;

                const leadgenId = change.value.leadgen_id;
                console.log(`[Meta Webhook] Processing leadgen_id: ${leadgenId}`);

                // Idempotency: skip if already processed
                const processedRef = db.collection('processed_meta_leads').doc(leadgenId);
                const processedDoc = await processedRef.get();
                if (processedDoc.exists) {
                    console.log(`[Meta Webhook] Skip - leadgen_id ${leadgenId} already processed.`);
                    continue;
                }

                await processedRef.set({
                    processedAt: new Date().toISOString(),
                    status: 'processing'
                });

                // Fetch lead details from Graph API
                let leadDetails;
                try {
                    const response = await axios.get(`https://graph.facebook.com/v19.0/${leadgenId}?fields=id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic,platform,field_data&access_token=${META_ACCESS_TOKEN}`);
                    leadDetails = response.data;
                } catch (error) {
                    console.error(`[Meta Webhook] Error fetching lead ${leadgenId}:`, error.response?.data || error.message);
                    await processedRef.update({ status: 'failed', error: error.message });
                    continue;
                }

                // Extract fields (Meta uses name/value pairs in field_data)
                let fullName = 'Unknown Meta Lead';
                let phone = '';
                let email = '';
                let companyName = '';
                let website = '';
                let customNotes = [];
                
                if (leadDetails.field_data) {
                    for (const field of leadDetails.field_data) {
                        const val = field.values[0];
                        if (field.name === 'full_name' || field.name === 'name') {
                            fullName = val;
                        } else if (field.name === 'first_name') {
                            if (fullName === 'Unknown Meta Lead') fullName = val;
                            else fullName = val + ' ' + fullName;
                        } else if (field.name === 'last_name') {
                            if (fullName === 'Unknown Meta Lead') fullName = val;
                            else fullName = fullName + ' ' + val;
                        } else if (field.name === 'phone_number' || field.name === 'work_phone_number' || field.name === 'phone') {
                            phone = val;
                        } else if (field.name === 'email' || field.name === 'work_email' || field.name === 'work_email_address') {
                            email = val;
                        } else if (field.name === 'company_name') {
                            companyName = val;
                        } else if (field.name === 'website' || field.name === 'your_website') {
                            website = val;
                        } else {
                            // Add mapping for custom questions if needed
                            customNotes.push(`${field.name}: ${val}`);
                        }
                    }
                }
                
                const normalizedPhoneValue = normalizePhone(phone);
                const phoneVariants = getPhoneVariants(phone);
                
                // Deduplication
                if (phone && phone !== '<test lead: dummy data for phone_number>') {
                    const existingSnapshot = await db.collection('opportunities')
                        .where('phone', 'in', phoneVariants)
                        .limit(1)
                        .get();
                        
                    if (!existingSnapshot.empty) {
                        console.log(`[Meta Webhook] Skip - Lead with phone ${phone} already exists.`);
                        await processedRef.update({
                            status: 'duplicate_skipped',
                            leadId: existingSnapshot.docs[0].id
                        });
                        continue;
                    }
                }
                
                // Assign
                const { name: assignedName, email: assignedTo } = await getNextAssignee();
                
                // Create Lead
                const opportunityData = {
                    name: fullName,
                    contactName: fullName,
                    contactPhone: normalizedPhoneValue,
                    contactEmail: email,
                    phone: normalizedPhoneValue,
                    secondaryPhones: [],
                    companyName: companyName,
                    value: 0,
                    budget: '',
                    your_website: website,
                    country: null,
                    source: 'Meta',
                    meta_campaign: leadDetails.campaign_name || '',
                    meta_adset: leadDetails.adset_name || '',
                    stage: '16', // assuming this is a default new lead stage
                    status: 'Open',
                    owner: assignedTo,
                    followUpAssignee: assignedTo,
                    isAIPending: false,
                    tags: ['meta', `Form: ${change.value.form_id || 'Unknown'}`],
                    tasks: [],
                    notes: [
                        {
                            id: Date.now().toString(),
                            content: `Lead captured from Meta Lead Ad
- Lead ID: ${leadgenId}
- Campaign: ${leadDetails.campaign_name || 'Unknown'} (ID: ${change.value.campaign_id || 'Unknown'})
- Ad Set: ${leadDetails.adset_name || 'Unknown'} (ID: ${change.value.adgroup_id || 'Unknown'})
- Ad: ${leadDetails.ad_name || 'Unknown'} (ID: ${change.value.ad_id || 'Unknown'})
- Form: ${leadDetails.form_name || 'Unknown'} (ID: ${change.value.form_id || 'Unknown'})
- Platform: ${leadDetails.platform || 'Unknown'}
- Page ID: ${change.value.page_id || 'Unknown'}` + (customNotes.length > 0 ? `\n\nForm Responses:\n${customNotes.join('\n')}` : ''),
                            createdAt: new Date().toISOString()
                        }
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
                        description: `Lead created via Meta Webhook`,
                        timestamp: new Date().toISOString(),
                        userName: 'Meta Automation'
                    }]
                };

                const docRef = await db.collection('opportunities').add(opportunityData);
                console.log(`[Meta Webhook] ✅ Created lead ${docRef.id} for ${fullName} (Assigned to: ${assignedName})`);
                
                await processedRef.update({
                    status: 'completed',
                    leadId: docRef.id,
                    completedAt: new Date().toISOString()
                });
            }
        }

        return res.status(200).send('EVENT_RECEIVED');

    } catch (error) {
        console.error('[Meta Webhook] ERROR:', error.message);
        return res.status(500).send('Internal Server Error');
    }
});

/**
 * Scheduled function to check for lead follow-up deadlines and new assignments every 5 minutes
 */
exports.deadlineAlerts = functions.pubsub.schedule('every 5 minutes').onRun(async (context) => {
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
        const today = getISTDateString();

        const cutoffDateStr = '2026-06-04'; // Apply escalations only for dates scheduled from June 4th, 2026 onward

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

        // --- 2. REAL-TIME DEADLINE CHECK (5 Min Delay) ---
        // If followUpDate is TODAY and we haven't notified for today yet
        if (lead.followUpDate && lead.followUpDate >= cutoffDateStr && lead.followUpDate === today && lead.deadlineNotifiedAt !== today && lead.followUpAssignee) {
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

        // --- 3. MISSED FOLLOW-UP DATE ESCALATION ---
        if (lead.followUpDate && lead.followUpDate >= cutoffDateStr && lead.followUpDate < today && lead.followUpEscalated !== lead.followUpDate) {
            const assigneeRaw = lead.followUpAssignee || lead.owner || '';
            const member = USERS.find(u => u.name.toLowerCase() === assigneeRaw.toLowerCase() || u.email.toLowerCase() === assigneeRaw.toLowerCase());
            const ownerEmail = member ? member.email : assigneeRaw;
            
            console.log(`[Deadline Alerts] Escalating missed follow-up for ${lead.name} (Assignee: ${assigneeRaw})`);
            const subject = `⚠️ URGENT: Missed Follow-up for ${lead.name}`;
            const html = `
                <div style="font-family: Arial, sans-serif; border: 2px solid #ef4444; border-radius: 8px; padding: 20px; max-width: 600px;">
                    <div style="background-color: #ef4444; color: white; padding: 10px 20px; border-radius: 4px; text-align: center; font-weight: bold; font-size: 18px; margin-bottom: 20px;">
                        ⚠️ URGENT: MISSED FOLLOW-UP
                    </div>
                    <p style="color: #374151; font-size: 16px;">The following lead has breached their scheduled follow-up date and requires immediate intervention.</p>
                    <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                        <tr><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Lead Name:</td><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: bold;">${lead.name}</td></tr>
                        <tr><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Assignee:</td><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #ef4444;">${assigneeRaw || 'Unassigned'}</td></tr>
                        <tr><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Missed Date:</td><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: bold;">${lead.followUpDate}</td></tr>
                    </table>
                    <p style="margin-top: 20px; font-weight: bold; color: #ef4444; text-align: center;">An escalation penalty has been logged.</p>
                </div>
            `;
            await sendEmailWithCC('dhiraj@digitalmojo.in', subject, html, ownerEmail);
            await doc.ref.update({ followUpEscalated: lead.followUpDate });

            // Track escalation in employee_metrics
            if (ownerEmail) {
                await db.collection('employee_metrics').doc(ownerEmail).set({
                    escalationCount: admin.firestore.FieldValue.increment(1),
                    name: member ? member.name : assigneeRaw,
                    lastEscalation: now.toISOString()
                }, { merge: true });
            }
        }

        // --- 4. TASK DEADLINE ESCALATION (Time-based: WhatsApp @ Deadline, Email @ Deadline + 15 mins) ---
        if (Array.isArray(lead.tasks)) {
            let tasksUpdated = false;
            const updatedTasks = lead.tasks.map(task => {
                if (!task.isCompleted && task.dueDate && task.dueDate >= cutoffDateStr) {
                    // Assuming India Standard Time (+05:30) for deadlines since the user operates in IST
                    const dueTimeStr = task.dueTime || '23:59';
                    const deadlineStr = `${task.dueDate}T${dueTimeStr}:00+05:30`;
                    const deadlineTime = new Date(deadlineStr).getTime();
                    const nowTime = now.getTime();

                    // Ensure the date parsing is valid before proceeding
                    if (!isNaN(deadlineTime)) {
                        const assigneeRaw = task.assignee || lead.owner || '';
                        const member = USERS.find(u => u.name.toLowerCase() === assigneeRaw.toLowerCase() || u.email.toLowerCase() === assigneeRaw.toLowerCase());
                        const ownerEmail = member ? member.email : assigneeRaw;

                        // Stage 1: Deadline Reached -> Send WhatsApp
                        if (nowTime >= deadlineTime && !task.whatsappEscalated) {
                            console.log(`[Deadline Alerts] Task WhatsApp Escalation for ${lead.name}: ${task.title}`);
                            const contextMsg = `Task Missed: ${task.title} (Due: ${task.dueDate} ${dueTimeStr})`;
                            
                            // Notify Assignee
                            if (ownerEmail) {
                                notifyTeamMember(ownerEmail, {
                                    type: 'deadline', leadName: lead.name, leadPhone: lead.contactPhone || lead.phone,
                                    project: lead.project, followUpDate: lead.followUpDate, context: contextMsg
                                });
                            }
                            // Notify Dhiraj
                            notifyTeamMember('dhiraj@digitalmojo.in', {
                                type: 'deadline', leadName: lead.name, leadPhone: lead.contactPhone || lead.phone,
                                project: lead.project, followUpDate: lead.followUpDate, context: contextMsg
                            });
                            
                            task.whatsappEscalated = now.toISOString();
                            tasksUpdated = true;
                        } 
                        // Stage 2: 15 minutes past deadline -> Send Email
                        else if (nowTime >= (deadlineTime + 15 * 60 * 1000) && !task.emailEscalated && task.whatsappEscalated) {
                            console.log(`[Deadline Alerts] Task Email Escalation for ${lead.name}: ${task.title}`);
                            const subject = `🚨 ESCALATION: Missed Task for ${lead.name}`;
                            const html = `
                                <div style="font-family: Arial, sans-serif; border: 2px solid #ef4444; border-radius: 8px; padding: 20px; max-width: 600px;">
                                    <div style="background-color: #ef4444; color: white; padding: 10px 20px; border-radius: 4px; text-align: center; font-weight: bold; font-size: 18px; margin-bottom: 20px;">
                                        🚨 ESCALATION: MISSED TASK DEADLINE
                                    </div>
                                    <p style="color: #374151; font-size: 16px;">A critical task is now <strong>15 minutes overdue</strong> and was not completed after the initial WhatsApp warning.</p>
                                    <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                                        <tr><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Lead Name:</td><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: bold;">${lead.name}</td></tr>
                                        <tr><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Task:</td><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: bold;">${task.title}</td></tr>
                                        <tr><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Assignee:</td><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #ef4444;">${assigneeRaw || 'Unassigned'}</td></tr>
                                        <tr><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Due Time:</td><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: bold;">${task.dueDate} ${dueTimeStr}</td></tr>
                                    </table>
                                    <p style="margin-top: 20px; font-weight: bold; color: #ef4444; text-align: center;">An escalation penalty has been logged.</p>
                                </div>
                            `;
                            sendEmailWithCC('dhiraj@digitalmojo.in', subject, html, ownerEmail);
                            task.emailEscalated = now.toISOString();
                            tasksUpdated = true;

                            // Track escalation in employee_metrics
                            if (ownerEmail) {
                                // Add to a tracking array so we can perform the set outside the map, or since map isn't async we can just do it without await, 
                                // but better to just trigger it here. It's safe to fire and forget inside map since it's a Firestore write
                                db.collection('employee_metrics').doc(ownerEmail).set({
                                    escalationCount: admin.firestore.FieldValue.increment(1),
                                    name: member ? member.name : assigneeRaw,
                                    lastEscalation: now.toISOString()
                                }, { merge: true });
                            }
                        }
                    }
                }
                return task;
            });
            
            if (tasksUpdated) {
                await doc.ref.update({ tasks: updatedTasks });
            }
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
    const realNowMs = Date.now();

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
                context: `🚨 *URGENT - 5 MINUTE SLA BREACHED* 🚨\n\n*Lead:* ${lead.name}\n\n⚠️ This lead was assigned but has not been contacted within the mandatory 5-minute window.\n\n*Type:* ${lead.isPooled ? 'Staggered Pool' : 'Immediate'}\n*Assigned to:* ${ownerName}\n\n_Automated Mojo CRM Alert_`
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

    // --- NEW ESCALATION LOGIC ---
    
    // 1 & 2. Stage 16 (Yet to contact) Escalations
    // We already have snapshot of Stage 16 open leads
    for (const doc of snapshot.docs) {
        const lead = doc.data();
        
        const assigneeRaw = lead.followUpAssignee || lead.owner;
        const member = USERS.find(u =>
            u.id === assigneeRaw ||
            u.email === assigneeRaw ||
            u.email?.toLowerCase() === (assigneeRaw || '').toLowerCase() ||
            u.name?.toLowerCase() === (assigneeRaw || '').toLowerCase()
        );
        const ownerName = member ? member.name : (assigneeRaw || 'Unassigned');
        const ownerEmail = member ? member.email : assigneeRaw;
        
        const createdAt = lead.createdAt ? new Date(lead.createdAt) : new Date();
        const effectiveTimeInStage = getEffectiveTimeMs(createdAt.getTime(), realNowMs);
        const oneDayMs = 24 * 60 * 60 * 1000;
        
        let updates = {};
        
        // 1. Stage 16: T+1 Days Alert
        if (effectiveTimeInStage >= oneDayMs) {
            const lastT1Sent = lead.lastEscalation16At ? new Date(lead.lastEscalation16At).getTime() : 0;
            const effectiveTimeSinceLastT1 = lastT1Sent ? getEffectiveTimeMs(lastT1Sent, realNowMs) : effectiveTimeInStage;
            if (effectiveTimeSinceLastT1 >= oneDayMs) {
                console.log(`[Urgent Alerts] Stage 16 T+1 escalation for ${lead.name}`);
                const subject = `Urgent Escalation: ${lead.name} untouched for >1 Day`;
                const html = getEscalationEmailHtml(
                    'Lead Untouched for > 24 Hours',
                    lead.name,
                    [
                        { label: 'Current Stage', value: 'Yet to contact' },
                        { label: 'Time Uncontacted', value: 'Over 24 Hours' },
                        { label: 'Assignee', value: ownerName }
                    ]
                );
                await sendEmailWithCC('dhiraj@digitalmojo.in', subject, html, ownerEmail);
                updates.lastEscalation16At = new Date().toISOString();
            }
        }
        
        // 2. Stage 16: Post-call 2 hours & 10 mins logic
        if (lead.calls && lead.calls.length > 0) {
            const sortedCalls = [...lead.calls].sort((a,b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
            const latestCall = sortedCalls[0];
            const callTime = new Date(latestCall.startTime);
            const timeSinceCallMs = getEffectiveTimeMs(callTime.getTime(), realNowMs);
            
            const twoHoursMs = 2 * 60 * 60 * 1000;
            const twoHours10MinMs = twoHoursMs + (10 * 60 * 1000);
            
            if (timeSinceCallMs >= twoHoursMs && timeSinceCallMs < twoHours10MinMs) {
                if (lead.escalatedCallId2H !== latestCall.id) {
                    console.log(`[Urgent Alerts] Stage 16 2-hour post-call warning for ${lead.name}`);
                    if (member && member.phone) {
                        await sendWatiSessionMessage(member.phone, `🚨 *URGENT - ACTION REQUIRED IMMEDIATELY* 🚨\n\n*Lead:* ${lead.name}\n\n⚠️ You called this lead *2 hours ago* but haven't updated the CRM stage. \n\n⏳ *You have 10 minutes* to update it before this is escalated to management.\n\n_Automated Mojo CRM Alert_`);
                    }
                    updates.escalatedCallId2H = latestCall.id;
                }
            }
            
            if (timeSinceCallMs >= twoHours10MinMs) {
                if (lead.escalatedCallId2H10M !== latestCall.id) {
                    console.log(`[Urgent Alerts] Stage 16 2h10m post-call escalation for ${lead.name}`);
                    const subject = `Urgent Escalation: ${lead.name} stage not updated post-call`;
                    const html = getEscalationEmailHtml(
                        'Stage Not Updated Post-Call',
                        lead.name,
                        [
                            { label: 'Issue', value: 'Called > 2 hours ago, but stage is still "Yet to contact"' },
                            { label: 'Assignee', value: ownerName }
                        ]
                    );
                    await sendEmailWithCC('dhiraj@digitalmojo.in', subject, html, ownerEmail);
                    updates.escalatedCallId2H10M = latestCall.id;
                }
            }
        }
        
        if (Object.keys(updates).length > 0) {
            await doc.ref.update(updates);
        }
    }
    
    // 3. Stage 16.5 (Not Answering) T+1 Days Alert & Auto Task
    const snapshot165 = await db.collection('opportunities')
        .where('status', '==', 'Open')
        .where('stage', '==', '16.5')
        .get();
        
    for (const doc of snapshot165.docs) {
        const lead = doc.data();
        const assigneeRaw = lead.followUpAssignee || lead.owner;
        const member = USERS.find(u =>
            u.id === assigneeRaw ||
            u.email === assigneeRaw ||
            u.email?.toLowerCase() === (assigneeRaw || '').toLowerCase() ||
            u.name?.toLowerCase() === (assigneeRaw || '').toLowerCase()
        );
        const ownerName = member ? member.name : (assigneeRaw || 'Unassigned');
        const ownerEmail = member ? member.email : assigneeRaw;
        
        // Find latest note or call or entered stage time to prevent fake update loop holes
        let baselineMs = lead.createdAt ? new Date(lead.createdAt).getTime() : 0;
        if (lead.activities && lead.activities.length > 0) {
            const stageEntryActivities = lead.activities.filter(a => a.type === 'status_change' && a.description && a.description.includes('Not Answering'));
            if (stageEntryActivities.length > 0) {
                const latestStageMs = Math.max(...stageEntryActivities.map(a => new Date(a.timestamp || 0).getTime()));
                if (latestStageMs > baselineMs) baselineMs = latestStageMs;
            }
        }
        
        let lastActivityMs = baselineMs;

        if (lead.notes && lead.notes.length > 0) {
            const latestNoteMs = Math.max(...lead.notes.map(n => new Date(n.createdAt?.seconds ? n.createdAt.toDate() : n.createdAt || 0).getTime()));
            if (latestNoteMs > lastActivityMs) lastActivityMs = latestNoteMs;
        }
        
        if (lead.calls && lead.calls.length > 0) {
            const latestCallMs = Math.max(...lead.calls.map(c => new Date(c.datetime || 0).getTime()));
            if (latestCallMs > lastActivityMs) lastActivityMs = latestCallMs;
        }

        const lastActivityTime = new Date(lastActivityMs);
        const timeSinceActivity = getEffectiveTimeMs(lastActivityMs, realNowMs);
        const oneDayMs = 24 * 60 * 60 * 1000;
        
        if (timeSinceActivity >= oneDayMs) {
            const last165Sent = lead.lastEscalation165At ? new Date(lead.lastEscalation165At).getTime() : 0;
            const timeSinceLast165 = last165Sent ? getEffectiveTimeMs(last165Sent, realNowMs) : timeSinceActivity;
            // Only alert once per 24h of inactivity
            if (timeSinceLast165 >= oneDayMs) {
                console.log(`[Urgent Alerts] Stage 16.5 T+1 escalation for ${lead.name}`);
                const subject = `Urgent Escalation: ${lead.name} (Not Answering) no activity`;
                const html = getEscalationEmailHtml(
                    'No Activity for > 24 Hours',
                    lead.name,
                    [
                        { label: 'Current Stage', value: 'Not Answering' },
                        { label: 'Issue', value: 'No calls or notes added for over 24 hours.' },
                        { label: 'Assignee', value: ownerName }
                    ]
                );
                await sendEmailWithCC('dhiraj@digitalmojo.in', subject, html, ownerEmail);
                
                // Create auto task for next day
                const tomorrow = new Date(nowIST);
                tomorrow.setDate(tomorrow.getDate() + 1);
                if (tomorrow.getDay() === 0) { // Skip Sunday
                    tomorrow.setDate(tomorrow.getDate() + 1);
                }
                const yyyy = tomorrow.getFullYear();
                const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
                const dd = String(tomorrow.getDate()).padStart(2, '0');
                
                const newTask = {
                    id: Math.random().toString(36).substr(2, 9),
                    title: 'Follow up (Not Answering)',
                    description: 'Auto-generated task: Lead has been unresponsive. Please try calling again or update notes.',
                    dueDate: `${yyyy}-${mm}-${dd}`,
                    isCompleted: false,
                    assignee: member ? member.id : assigneeRaw,
                    assignedBy: 'System'
                };
                
                const tasks = lead.tasks || [];
                tasks.push(newTask);
                
                await doc.ref.update({ 
                    lastEscalation165At: new Date().toISOString(),
                    tasks: tasks
                });
            }
        }
    }
    
    // 4. Missed Task Deadline alerts
    const allOpenOpps = await db.collection('opportunities').where('status', '==', 'Open').get();
    for (const doc of allOpenOpps.docs) {
        const lead = doc.data();
        if (!lead.tasks || lead.tasks.length === 0) continue;
        
        let anyTasksUpdated = false;
        
        for (let i = 0; i < lead.tasks.length; i++) {
            let t = lead.tasks[i];
            if (!t.isCompleted && t.dueDate && !t.deadlineEscalated) {
                // Parse due date and time correctly in IST
                const dueDateTimeStr = t.dueTime ? `${t.dueDate}T${t.dueTime}:00+05:30` : `${t.dueDate}T23:59:59+05:30`;
                const dueDateDate = new Date(dueDateTimeStr);
                
                if (nowIST > dueDateDate) {
                    const assigneeRaw = t.assignee || lead.followUpAssignee || lead.owner;
                    const member = USERS.find(u =>
                        u.id === assigneeRaw ||
                        u.email === assigneeRaw ||
                        u.email?.toLowerCase() === (assigneeRaw || '').toLowerCase() ||
                        u.name?.toLowerCase() === (assigneeRaw || '').toLowerCase()
                    );
                    const ownerName = member ? member.name : (assigneeRaw || 'Unassigned');
                    const ownerEmail = member ? member.email : assigneeRaw;
                    const ownerPhone = member ? member.phone : null;
                    const dhirajPhone = '919908398763';

                    if (!t.whatsappEscalated) {
                        console.log(`[Urgent Alerts] Missed task deadline WhatsApp for ${lead.name}`);
                        const waMsg = `🚨 *Task Deadline Missed* 🚨\n\n*Lead:* ${lead.name}\n*Task:* ${t.title}\n*Assignee:* ${ownerName}\n\nPlease complete this task immediately!`;
                        if (ownerPhone) {
                            await sendWatiSessionMessage(ownerPhone, waMsg).catch(e => console.error(e));
                        }
                        await sendWatiSessionMessage(dhirajPhone, waMsg).catch(e => console.error(e));
                        
                        t.whatsappEscalated = true;
                        t.deadlineMissedAt = new Date().toISOString(); // Record time of first alert
                        anyTasksUpdated = true;
                    } else if (!t.deadlineEscalated && t.deadlineMissedAt) {
                        // Wait 2 hours before escalating via email (2 * 60 * 60 * 1000 = 7200000 ms)
                        const missedAtMs = new Date(t.deadlineMissedAt).getTime();
                        if (realNowMs >= missedAtMs + 7200000) {
                            console.log(`[Urgent Alerts] Missed task deadline Email for ${lead.name}`);
                            const subject = `Missed Task Deadline: ${t.title} for ${lead.name}`;
                            const html = getEscalationEmailHtml(
                                'Task Deadline Missed (Unresolved after 2 hours)',
                                lead.name,
                                [
                                    { label: 'Task', value: t.title },
                                    { label: 'Due Date', value: t.dueDate },
                                    { label: 'Assignee', value: ownerName }
                                ]
                            );
                            // Send async, don't await to avoid slowing down loop significantly
                            sendEmailWithCC('dhiraj@digitalmojo.in', subject, html, ownerEmail);
                            t.deadlineEscalated = true;
                            anyTasksUpdated = true;
                        }
                    } else if (!t.deadlineEscalated && !t.deadlineMissedAt) {
                         // Backwards compatibility for old tasks that might have bypassed whatsappEscalated somehow
                         t.deadlineMissedAt = new Date().toISOString();
                         t.whatsappEscalated = true;
                         anyTasksUpdated = true;
                    }
                }
            }
        }
        
        if (anyTasksUpdated) {
            await doc.ref.update({ tasks: lead.tasks });
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
            if (data.phone) getPhoneVariants(data.phone).forEach(v => numbers.add(v));
            if (data.contactPhone) getPhoneVariants(data.contactPhone).forEach(v => numbers.add(v));
            if (Array.isArray(data.secondaryPhones)) {
                data.secondaryPhones.forEach(p => {
                    getPhoneVariants(p).forEach(v => numbers.add(v));
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
            const phoneVariants = getPhoneVariants(rawPhone);

            // In-memory lookup: Much faster than Firestore queries in a loop
            let docs = [];
            for (const variant of phoneVariants) {
                if (variant && oppMap.has(variant)) {
                    docs = oppMap.get(variant);
                    break;
                }
            }
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
            if (rawPhone) {
                const phoneVariants = getPhoneVariants(rawPhone);
                const existing = await db.collection('opportunities')
                    .where('phone', 'in', phoneVariants)
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
                meta_campaign: leadData?.campaign_name || '',
                meta_adset: leadData?.adset_name || '',
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
 * ONE-TIME FIX: Backfills the correct status (Won/Abandoned) for leads currently in closed/junk/dead stages.
 */
exports.fixUrgentLeadsBackfill = functions.https.onRequest(async (req, res) => {
    const db = getDb();
    let updatedCount = 0;

    try {
        const settingsDoc = await db.collection('settings').doc('pipeline').get();
        const stagesArray = settingsDoc.exists ? settingsDoc.data().stages : [];
        const stages = {};
        stagesArray.forEach(stage => {
            stages[stage.id] = stage.title?.toLowerCase() || '';
        });

        const snapshot = await db.collection('opportunities').get();
        
        let batch = db.batch();
        let batchCount = 0;

        for (const doc of snapshot.docs) {
            const lead = doc.data();
            const stageName = stages[lead.stage] || '';
            let newStatus = null;

            if (stageName.includes('junk') || stageName.includes('no budget') || stageName.includes('dead')) {
                newStatus = 'Abandoned';
            } else if (stageName.includes('won') || stageName.includes('closed') || stageName.includes('success')) {
                newStatus = 'Won';
            }

            // Only update if the current status isn't already the correct one
            if (newStatus && lead.status !== newStatus) {
                batch.update(doc.ref, { status: newStatus });
                batchCount++;
                updatedCount++;
                
                if (batchCount === 450) {
                    await batch.commit();
                    batch = db.batch();
                    batchCount = 0;
                }
            }
        }
        
        if (batchCount > 0) {
            await batch.commit();
        }

        res.status(200).send(`Successfully updated ${updatedCount} opportunities.`);
    } catch (error) {
        console.error('Error backfilling status:', error);
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
/**
 * Core AI logic for analyzing a won/lost/abandoned lead.
 */
async function generateWinLossAnalysis(lead) {
    let discoveryForms = [];
    if (lead.contactPhone) {
        const db = getDb();
        const cleanDigits = lead.contactPhone.toString().replace(/\D/g, '');
        const normalizedPhone = cleanDigits.slice(-10);
        try {
            const snapshot = await db.collection('discovery_responses')
                .where('phone', '==', normalizedPhone)
                .get();
            discoveryForms = snapshot.docs.map(doc => doc.data());
        } catch (e) {
            console.error(`[WinLossAnalysis] Error fetching discovery forms for ${lead.name}:`, e.message);
        }
    }

    const prompt = `You are an expert sales analyst and Zig Ziglar disciple.
Analyze this lead which was marked as ${lead.status}.
Lead Name: ${lead.name}
Value: ${lead.value}
Source: ${lead.source || 'N/A'}
Budget: ${lead.budget || 'N/A'}
Tags: ${JSON.stringify(lead.tags || [])}
UTM Source: ${lead.utm_source || 'N/A'}
UTM Medium: ${lead.utm_medium || 'N/A'}
UTM Campaign: ${lead.utm_campaign || 'N/A'}
Notes: ${JSON.stringify(lead.notes || [])}
Calls: ${JSON.stringify((lead.calls || []).map(c => ({ duration: c.duration, rating: c.aiAnalysis?.rating, summary: c.aiAnalysis?.summary })))}
Tasks: ${JSON.stringify(lead.tasks || [])}
Activities: ${JSON.stringify(lead.activities || [])}
Discovery Forms (Client filled out): ${JSON.stringify(discoveryForms)}

Provide a JSON response with:
{
    "score": number (0-100) representing how well this lead was handled or the quality of the lead,
    "combinedReason": "A 1-2 sentence punchy combined reason for why it was Won, Lost, or Abandoned based on the data.",
    "isPotentialLead": boolean (true ONLY if it was Lost or Abandoned BUT shows high potential to be revived later based on budget/interest),
    "potentialReason": "If isPotentialLead is true, explain exactly why in 1 sentence. Otherwise leave null."
}
Format your response as a valid JSON object only. No markdown.`;

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(prompt);
        let text = (await result.response).text().replace(/```json\n?|\n?```/g, '').trim();
        return JSON.parse(text);
    } catch (e) {
        console.error(`[WinLossAnalysis] AI error for ${lead.name}:`, e.message);
        return null;
    }
}

/**
 * Core AI logic for analyzing an open lead (client review).
 */
async function generateClientReview(lead) {
    let discoveryForms = [];
    if (lead.contactPhone) {
        const db = getDb();
        const cleanDigits = lead.contactPhone.toString().replace(/\D/g, '');
        const normalizedPhone = cleanDigits.slice(-10);
        try {
            const snapshot = await db.collection('discovery_responses')
                .where('phone', '==', normalizedPhone)
                .get();
            discoveryForms = snapshot.docs.map(doc => doc.data());
        } catch (e) {
            console.error(`[ClientReviewAnalysis] Error fetching discovery forms for ${lead.name}:`, e.message);
        }
    }

    const prompt = `You are an expert sales manager and analyst.
Analyze this active open lead and provide actionable feedback for the sales rep.
Lead Name: ${lead.name}
Value: ${lead.value}
Stage: ${lead.stage}
Source: ${lead.source || 'N/A'}
Budget: ${lead.budget || 'N/A'}
Tags: ${JSON.stringify(lead.tags || [])}
UTM Source: ${lead.utm_source || 'N/A'}
UTM Medium: ${lead.utm_medium || 'N/A'}
UTM Campaign: ${lead.utm_campaign || 'N/A'}
Notes: ${JSON.stringify(lead.notes || [])}
Calls: ${JSON.stringify((lead.calls || []).map(c => ({ duration: c.duration, rating: c.aiAnalysis?.rating, summary: c.aiAnalysis?.summary })))}
Tasks: ${JSON.stringify(lead.tasks || [])}
Activities: ${JSON.stringify(lead.activities || [])}
Discovery Forms (Client filled out): ${JSON.stringify(discoveryForms)}

Provide a JSON response with:
{
    "strengths": "1-2 sentences explaining what the sales rep is doing right with this lead so far based on the history.",
    "improvements": "1-2 sentences of actionable advice on what the sales rep can do to improve engagement or push the deal forward."
}
Format your response as a valid JSON object only. No markdown.`;

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(prompt);
        let text = (await result.response).text().replace(/```json\n?|\n?```/g, '').trim();
        return JSON.parse(text);
    } catch (e) {
        console.error(`[ClientReviewAnalysis] AI error for ${lead.name}:`, e.message);
        return null;
    }
}

/**
 * Scheduled function to analyze closed leads once a day.
 */
exports.dailyWinLossAnalysis = functions.pubsub.schedule('0 0 * * *').onRun(async (context) => {
    console.log('[WinLossAnalysis] Starting daily analysis...');
    const db = getDb();
    
    // We fetch leads that are closed but have no analysis yet.
    // To avoid massive reads if there are thousands, we'll fetch up to 20 at a time.
    const snapshot = await db.collection('opportunities')
        .where('status', 'in', ['Won', 'Lost', 'Abandoned'])
        .get();
        
    let processedCount = 0;
    
    for (const doc of snapshot.docs) {
        const lead = doc.data();
        if (lead.winLossAnalysis) continue; // Already analyzed
        if (processedCount >= 20) break; // Limit daily batch
        
        console.log(`[WinLossAnalysis] Analyzing lead: ${lead.name}`);
        const analysis = await generateWinLossAnalysis(lead);
        
        if (analysis) {
            await doc.ref.update({
                winLossAnalysis: {
                    ...analysis,
                    analyzedAt: new Date().toISOString()
                }
            });
            processedCount++;
        }
    }
    console.log(`[WinLossAnalysis] Completed daily analysis for ${processedCount} leads.`);
});

/**
 * Callable function for manual Win/Loss analysis on demand.
 */
exports.analyzeWinLossManual = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Not authorized.');
    
    const { opportunityId } = data;
    if (!opportunityId) throw new functions.https.HttpsError('invalid-argument', 'Missing opportunityId');
    
    const db = getDb();
    const docRef = db.collection('opportunities').doc(opportunityId);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) throw new functions.https.HttpsError('not-found', 'Lead not found');
    
    const lead = docSnap.data();
    if (!['Won', 'Lost', 'Abandoned'].includes(lead.status)) {
        throw new functions.https.HttpsError('failed-precondition', 'Lead must be Won, Lost, or Abandoned.');
    }
    
    const analysis = await generateWinLossAnalysis(lead);
    if (!analysis) {
        throw new functions.https.HttpsError('internal', 'AI Analysis failed.');
    }
    
    const updateData = {
        winLossAnalysis: {
            ...analysis,
            analyzedAt: new Date().toISOString()
        }
    };
    
    await docRef.update(updateData);
    return updateData.winLossAnalysis;
});

exports.huskyvoiceWebhook = huskyvoiceWebhook;
exports.processPendingAICalls = processPendingAICalls;

// Export helpers for use in other modules
exports.sendLeadWelcomeSequence = sendLeadWelcomeSequence;
exports.USERS = USERS;

exports.analyzeClientReviewManual = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Not authorized.');
    
    const { opportunityId } = data;
    if (!opportunityId) throw new functions.https.HttpsError('invalid-argument', 'Missing opportunityId');
    
    const db = getDb();
    const docRef = db.collection('opportunities').doc(opportunityId);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) throw new functions.https.HttpsError('not-found', 'Lead not found');
    
    const lead = docSnap.data();
    
    const analysis = await generateClientReview(lead);
    if (!analysis) {
        throw new functions.https.HttpsError('internal', 'AI Analysis failed.');
    }
    
    const updateData = {
        clientReview: {
            ...analysis,
            analyzedAt: new Date().toISOString()
        }
    };
    
    await docRef.update(updateData);
    return updateData.clientReview;
});

async function generateGlobalWinLossSummary(type, leads) {
    const prompt = `You are an expert sales director.
Analyze the following ${type} leads from the recent period to find global trends, patterns, strengths, and weaknesses in the sales process.
Here is the data for all ${type} leads, including notes, calls, tasks, and discovery form data:
${JSON.stringify(leads.map(l => ({ 
    name: l.name, 
    value: l.value, 
    source: l.source, 
    tags: l.tags, 
    reason: l.winLossAnalysis?.combinedReason, 
    calls: (l.calls || []).slice(-3), 
    tasks: (l.tasks || []).slice(-3),
    notes: (l.notes || []).slice(-3),
    activities: (l.activities || []).slice(-3),
    discoveryForm: l.discoveryForm
})))}

Provide a JSON response with:
{
    "summary": "1-2 paragraphs summarizing the overarching trends and reasons for ${type === 'Won' ? 'winning' : 'losing'} these leads.",
    "keyTakeaways": ["point 1", "point 2", "point 3"],
    "actionableAdvice": "1-2 sentences of advice for the sales team based on these trends."
}
Format your response as a valid JSON object only. No markdown.`;

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(prompt);
        let text = (await result.response).text().replace(/```json\n?|\n?```/g, '').trim();
        return JSON.parse(text);
    } catch (e) {
        console.error(`[GlobalWinLossAnalysis] AI error for ${type}:`, e.message);
        return null;
    }
}

async function createGlobalReport(db, wonLeads, lostLeads) {
    const wonAnalysis = await generateGlobalWinLossSummary('Won', wonLeads);
    const lostAnalysis = await generateGlobalWinLossSummary('Lost/Abandoned', lostLeads);
    
    const reportDoc = {
        type: 'global_win_loss_summary',
        createdAt: new Date().toISOString(),
        data: {
            wonLeadsAnalysis: {
                overallSummary: wonAnalysis?.summary || 'No data generated.',
                keySuccessFactors: wonAnalysis?.keyTakeaways || [],
                actionableRecommendation: wonAnalysis?.actionableAdvice || 'N/A'
            },
            lostLeadsAnalysis: {
                overallSummary: lostAnalysis?.summary || 'No data generated.',
                commonFailureReasons: lostAnalysis?.keyTakeaways || [],
                actionableRecommendation: lostAnalysis?.actionableAdvice || 'N/A'
            },
            executiveDirectives: [
                "Review the actionable recommendations with the team in the next sync.",
                "Reinforce key success factors from the Won leads on all ongoing deals.",
                "Address common failure points by adding targeted coaching sessions."
            ]
        }
    };
    
    await db.collection('system_metrics').add(reportDoc);
    return reportDoc;
}

exports.dailyGlobalWinLossAnalysis = functions.pubsub.schedule('30 0 * * *').onRun(async (context) => {
    console.log('[GlobalWinLossAnalysis] Starting daily global analysis...');
    const db = getDb();
    
    const wonSnapshot = await db.collection('opportunities').where('status', '==', 'Won').get();
    const lostSnapshot = await db.collection('opportunities').where('status', 'in', ['Lost', 'Abandoned']).get();
    
    const wonLeads = wonSnapshot.docs.map(d => d.data());
    const lostLeads = lostSnapshot.docs.map(d => d.data());
    
    await createGlobalReport(db, wonLeads, lostLeads);
    console.log('[GlobalWinLossAnalysis] Completed global analysis.');
});

exports.triggerGlobalWinLossAnalysisManual = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Not authorized.');
    
    const db = getDb();
    
    const wonSnapshot = await db.collection('opportunities').where('status', '==', 'Won').get();
    const lostSnapshot = await db.collection('opportunities').where('status', 'in', ['Lost', 'Abandoned']).get();
    
    const wonLeads = wonSnapshot.docs.map(d => d.data());
    const lostLeads = lostSnapshot.docs.map(d => d.data());
    
    return await createGlobalReport(db, wonLeads, lostLeads);
});

exports.analyzeOpenLeadsPotential = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Not authorized.');
    
    const db = getDb();
    
    // Fetch all leads that are not Won/Lost/Abandoned (i.e. they are open)
    // The system uses 'Open' for active leads
    const cutoffDate = new Date('2026-06-05T00:00:00Z');
    const openSnapshot = await db.collection('opportunities')
        .where('status', '==', 'Open')
        .get();
    
    const allLeads = openSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    // Filter leads created after the cutoff date
    const leads = allLeads.filter(l => {
        let createdAtDate = null;
        if (l.createdAt && l.createdAt.toDate) {
            createdAtDate = l.createdAt.toDate();
        } else if (l.createdAt) {
            createdAtDate = new Date(l.createdAt);
        }
        return createdAtDate && createdAtDate >= cutoffDate;
    });
    
    let updatedCount = 0;
    
    // Process in batches of 10 to avoid token limits and timeouts
    for (let i = 0; i < leads.length; i += 10) {
        const batchLeads = leads.slice(i, i + 10);
        
        const prompt = `You are an expert sales analyst.
Review the following open leads and assign an "aiPotentialScore" (0-100) based on their likelihood to convert.
Leads with strong engagement, multiple follow-ups, explicit interest, or solid budget/timeline should score >80.

Leads Data:
${JSON.stringify(batchLeads.map(l => ({
    id: l.id,
    name: l.name,
    value: l.value,
    notes: (l.notes || []).map(n => n.content).slice(-3),
    calls: (l.calls || []).map(c => c.summary || c.transcription).slice(-3)
})))}

Respond ONLY with a JSON array of objects:
[
  { "id": "lead_id", "aiPotentialScore": 85, "reason": "brief reason" }
]
No markdown, just raw JSON.`;

        try {
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
            const result = await model.generateContent(prompt);
            let text = (await result.response).text().replace(/```json\n?|\n?```/g, '').trim();
            const results = JSON.parse(text);
            
            const firestoreBatch = db.batch();
            for (const res of results) {
                const leadRef = db.collection('opportunities').doc(res.id);
                firestoreBatch.update(leadRef, {
                    aiPotentialScore: res.aiPotentialScore,
                    isHighPotential: res.aiPotentialScore >= 80,
                    potentialReason: res.reason
                });
                updatedCount++;
            }
            await firestoreBatch.commit();
        } catch (e) {
            console.error('Error analyzing potential for batch', e);
        }
    }
    
    return { success: true, updatedCount };
});

exports.analyzeSingleLeadPotential = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Not authorized.');
    
    const { leadId } = data;
    if (!leadId) throw new functions.https.HttpsError('invalid-argument', 'leadId is required');

    const db = getDb();
    const leadRef = db.collection('opportunities').doc(leadId);
    const doc = await leadRef.get();
    
    if (!doc.exists) {
        throw new functions.https.HttpsError('not-found', 'Lead not found');
    }

    const lead = doc.data();
    
    const prompt = `You are an expert sales analyst.
Review the following lead and assign an "aiPotentialScore" (0-100) based on their likelihood to convert.
The lead is currently in the "${lead.stage}" stage. Learn from all the interactions and current info to score it.
Leads with strong engagement, multiple follow-ups, explicit interest, or solid budget/timeline should score >80.

Lead Data:
${JSON.stringify({
    name: lead.name,
    value: lead.value,
    stage: lead.stage,
    notes: (lead.notes || []).map(n => n.content),
    calls: (lead.calls || []).map(c => c.summary || c.transcription),
    customFields: {
        budget: lead.budget,
        source: lead.source,
        company: lead.companyName
    }
})}

Respond ONLY with raw JSON:
{ "aiPotentialScore": 85, "reason": "brief reason" }`;

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(prompt);
        let text = (await result.response).text().replace(/\`\`\`json\n?|\n?\`\`\`/g, '').trim();
        const res = JSON.parse(text);
        
        await leadRef.update({
            aiPotentialScore: res.aiPotentialScore,
            isHighPotential: res.aiPotentialScore >= 80,
            potentialReason: res.reason
        });
        
        return { success: true, score: res.aiPotentialScore, reason: res.reason };
    } catch (e) {
        console.error('Error analyzing single lead potential', e);
        throw new functions.https.HttpsError('internal', 'Failed to score lead');
    }
});

exports.onOpportunityUpdateScoring = functions.firestore
    .document('opportunities/{opportunityId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();

        // Prevent infinite loops: only trigger if meaningful data changed
        const stageChanged = before.stage !== after.stage;
        const notesChanged = (before.notes?.length || 0) !== (after.notes?.length || 0);
        const callsChanged = (before.calls?.length || 0) !== (after.calls?.length || 0);
        const valueChanged = before.value !== after.value;
        
        if (!stageChanged && !notesChanged && !callsChanged && !valueChanged) return null;

        // Cutoff date check (June 5, 2026)
        const cutoffDate = new Date('2026-06-05T00:00:00Z');
        let createdAtDate = null;
        if (after.createdAt && after.createdAt.toDate) {
            createdAtDate = after.createdAt.toDate();
        } else if (after.createdAt) {
            createdAtDate = new Date(after.createdAt);
        }

        if (createdAtDate && createdAtDate < cutoffDate) {
            return null; // Skip old leads
        }

        const db = getDb();

        const prompt = `You are an expert sales analyst.
Review the following lead and assign an "aiPotentialScore" (0-100) based on their likelihood to convert.
The lead's stage, notes, or calls have just been updated. Learn from these interactions and try scoring it better every time as it moves through the pipeline.
Leads with strong engagement, multiple follow-ups, explicit interest, or solid budget/timeline should score >80.

Lead Data:
${JSON.stringify({
    name: after.name,
    value: after.value,
    stage: after.stage,
    notes: (after.notes || []).map(n => n.content),
    calls: (after.calls || []).map(c => c.summary || c.transcription),
    customFields: {
        budget: after.budget,
        source: after.source,
        company: after.companyName
    }
})}

Respond ONLY with raw JSON:
{ "aiPotentialScore": 85, "reason": "brief reason" }`;

        try {
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
            const result = await model.generateContent(prompt);
            let text = (await result.response).text().replace(/\`\`\`json\n?|\n?\`\`\`/g, '').trim();
            const res = JSON.parse(text);
            
            return change.after.ref.update({
                aiPotentialScore: res.aiPotentialScore,
                isHighPotential: res.aiPotentialScore >= 80,
                potentialReason: res.reason
            });
        } catch (e) {
            console.error('Error dynamic scoring for lead', context.params.opportunityId, e);
            return null;
        }
    });

/**
 * Webhook to receive incoming data from external systems.
 * Expects a static API key for authentication.
 * Does not create leads directly, just logs them into 'incoming_webhooks' collection.
 */
exports.incomingWebhook = functions.runWith({ timeoutSeconds: 30 }).region('us-central1').https.onRequest(async (req, res) => {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST');
        res.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
        res.status(204).send('');
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (apiKey !== 'dm-secret-key-2026') {
        console.warn(`[Incoming Webhook] Unauthorized access attempt. Key provided: ${apiKey}`);
        return res.status(401).send('Unauthorized: Invalid API Key');
    }

    const payload = req.body;
    console.log(`[Incoming Webhook] Received payload:`, JSON.stringify(payload).substring(0, 200));

    try {
        const db = getDb();
        const logDoc = {
            source: payload.source || 'external_system',
            payload: payload,
            receivedAt: new Date().toISOString()
        };

        await db.collection('incoming_webhooks').add(logDoc);
        console.log(`[Incoming Webhook] Payload logged successfully.`);
        
        return res.status(200).json({ success: true, message: 'Webhook received and logged' });
    } catch (error) {
        console.error(`[Incoming Webhook] Error saving payload:`, error);
        return res.status(500).json({ success: false, error: 'Failed to process webhook' });
    }
});

/**
 * Helper function to trigger outgoing webhooks
 */
async function triggerOutgoingWebhooks(event, data) {
    const db = getDb();
    const axios = require('axios');
    
    try {
        const possibleEvents = [event];
        if (event === 'lead.created') possibleEvents.push('Lead Created');
        if (event === 'lead.status_changed') possibleEvents.push('Status Changed');

        const webhooksSnapshot = await db.collection('webhooks')
            .where('isActive', '==', true)
            .where('events', 'array-contains-any', possibleEvents)
            .get();
            
        if (webhooksSnapshot.empty) {
            return;
        }

        const webhooks = webhooksSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`[Outgoing Webhooks] Triggering ${webhooks.length} webhooks for event: ${event}`);

        const promises = webhooks.map(async (webhook) => {
            try {
                const headers = { 'Content-Type': 'application/json' };
                if (webhook.secret) {
                    headers['x-webhook-secret'] = webhook.secret;
                }
                
                await axios.post(webhook.url, {
                    event: event,
                    timestamp: new Date().toISOString(),
                    data: data
                }, { 
                    headers: headers,
                    timeout: 10000 // 10s timeout
                });
                
                console.log(`[Outgoing Webhooks] Successfully triggered webhook ${webhook.name} (${webhook.url})`);
                
                // Update lastTriggered
                await db.collection('webhooks').doc(webhook.id).update({
                    lastTriggered: new Date().toISOString()
                });
            } catch (err) {
                console.error(`[Outgoing Webhooks] Failed to trigger webhook ${webhook.name} (${webhook.url}):`, err.message);
            }
        });

        await Promise.allSettled(promises);
    } catch (error) {
        console.error(`[Outgoing Webhooks] Error triggering webhooks:`, error);
    }
}

/**
 * Trigger for Lead Created event
 */
exports.onOpportunityCreatedWebhooks = functions.firestore
    .document('opportunities/{opportunityId}')
    .onCreate(async (snap, context) => {
        const newLead = snap.data();
        await triggerOutgoingWebhooks('lead.created', { id: context.params.opportunityId, ...newLead });
    });

/**
 * Trigger for Status Changed event
 */
exports.onOpportunityUpdatedWebhooks = functions.firestore
    .document('opportunities/{opportunityId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();

        if (before.stage !== after.stage) {
            await triggerOutgoingWebhooks('lead.status_changed', {
                id: context.params.opportunityId,
                oldStage: before.stage,
                newStage: after.stage,
                stage: after.stage, // Added for EasyInsights mapping
                leadName: after.name
            });
        }
    });

/**
 * Proxy to test outgoing webhooks securely (avoids CORS issues on the client)
 */
exports.testWebhook = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Not authorized.');
    
    const { url, secret } = data;
    if (!url) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing webhook URL.');
    }

    const axios = require('axios');
    
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (secret) {
            headers['x-webhook-secret'] = secret;
        }

        const response = await axios.post(url, {
            event: 'test',
            timestamp: new Date().toISOString(),
            data: { message: 'Test payload from Mojo CRM' }
        }, {
            headers: headers,
            timeout: 10000
        });

        return { success: true, status: response.status };
    } catch (error) {
        console.error('[Test Webhook] Error:', error.message);
        throw new functions.https.HttpsError('internal', `Test failed: ${error.message}`);
    }
});

