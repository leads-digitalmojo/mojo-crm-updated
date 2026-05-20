const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const axios = require('axios');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const getDb = () => admin.firestore();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);


// We will read the keys from process.env or settings dynamically.
// Or we can define them if we fetch them from firestore.

function getInIST(date = new Date()) {
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    return new Date(utc + IST_OFFSET);
}

function isBusinessHours() {
    const nowIST = getInIST();
    const day = nowIST.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    const hour = nowIST.getHours();
    
    if (day === 0 || day === 6) {
        return false; // Weekend
    }
    
    // 10 AM to 7 PM (19:00)
    if (hour >= 10 && hour < 19) {
        return true;
    }
    
    return false;
}

async function triggerHuskyvoiceCall(opportunityId, opportunityData) {
    console.log(`[Huskyvoice] Triggering AI Call for opportunity ${opportunityId}`);
    try {
        const db = getDb();
        const settingsSnap = await db.collection('settings').doc('huskyvoice').get();
        if (!settingsSnap.exists) {
            console.error('[Huskyvoice] Settings missing');
            return false;
        }
        
        const config = settingsSnap.data();
        const apiKey = config.api_key || process.env.HUSKYVOICE_API_KEY;
        const agentId = config.agent_id;
        
        if (!apiKey || !agentId) {
            console.error('[Huskyvoice] Missing API Key or Agent ID');
            return false;
        }

        // Format phone number to strictly E.164 +91
        let contactNumber = opportunityData.phone || opportunityData.contactPhone || '';
        // If it lacks +91, add it
        contactNumber = contactNumber.replace(/\D/g, ''); // strip to digits
        if (contactNumber.length === 10) {
            contactNumber = '+91' + contactNumber;
        } else if (contactNumber.length === 12 && contactNumber.startsWith('91')) {
            contactNumber = '+' + contactNumber;
        } else {
            console.error(`[Huskyvoice] Invalid phone length for India: ${contactNumber}`);
            return false;
        }

        const payload = {
            agent_id: agentId,
            contact_number: contactNumber,
            contact_name: opportunityData.name || 'Prospect',
            additional_info: {
                opportunity_id: opportunityId,
                company: opportunityData.companyName || 'Unknown'
            }
        };

        const res = await axios.post('https://api.huskyvoice.ai/v1/calls', payload, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`[Huskyvoice] API Response:`, res.data);

        await db.collection('opportunities').doc(opportunityId).update({
            aiCallId: res.data.data.call_id,
            aiCallStatus: 'Scheduled',
            updatedAt: new Date().toISOString()
        });
        
        return true;

    } catch (error) {
        console.error('[Huskyvoice] Error triggering call:', error.response?.data || error.message);
        return false;
    }
}

async function analyzeTranscriptWithGemini(transcript) {
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
        return { summary: "No transcript available for analysis.", suggestions: ["Consider calling the lead manually to follow up."] };
    }
    
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `You are an expert sales assistant analyzing a call transcript between an AI qualification agent and a lead. 
        Please provide a concise summary of the call and strategic suggestions for the human sales agent on how to follow up.
        
        Format the output precisely as JSON:
        {
          "summary": "Brief 1-2 sentence summary of what happened.",
          "suggestions": ["Suggestion 1", "Suggestion 2", "Suggestion 3"]
        }
        
        Transcript:
        ${transcript}
        `;
        
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return { summary: "Analysis failed to produce structured data.", suggestions: [] };
    } catch (error) {
        console.error('[Gemini] Analysis error:', error);
        return { summary: "AI analysis unavailable due to an error.", suggestions: [] };
    }
}

// HTTP Webhook to receive events from Huskyvoice
const huskyvoiceWebhook = functions.https.onRequest(async (req, res) => {
    // 1. Verify Signature
    const signature = req.headers['x-husky-signature'];
    const db = getDb();
    
    try {
        const settingsSnap = await db.collection('settings').doc('huskyvoice').get();
        const secret = settingsSnap.exists ? settingsSnap.data().webhook_secret : process.env.HUSKYVOICE_WEBHOOK_SECRET;
        
        if (secret && signature) {
            const payloadString = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
            const hmac = crypto.createHmac('sha256', secret);
            hmac.update(payloadString);
            const expected = hmac.digest('hex');
            
            if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
                console.error('[Huskyvoice Webhook] Signature verification failed');
                return res.status(401).send('Unauthorized');
            }
        }
        
        // 2. Process Event
        const { event_type, data } = req.body;
        console.log(`[Huskyvoice Webhook] Received event: ${event_type} for call ${data?.call_id}. Full Data: ${JSON.stringify(data)}`);
        
        if (event_type === 'call.completed') {
            const callId = data.call_id;
            
            // Find opportunity by call ID
            const oppsSnap = await db.collection('opportunities')
                .where('aiCallId', '==', callId)
                .limit(1)
                .get();
                
            if (!oppsSnap.empty) {
                const docRef = oppsSnap.docs[0].ref;
                const oppData = oppsSnap.docs[0].data();
                
                // Extract transcript from various possible fields - using exact 'call_transcript' from logs
                const transcriptArray = data.call_transcript || data.transcript || [];
                const transcriptText = Array.isArray(transcriptArray) 
                    ? transcriptArray.map(t => `${t.speaker === 'user' ? 'Lead' : 'AI'}: ${t.text}`).join('\n')
                    : (typeof transcriptArray === 'string' ? transcriptArray : '');
                
                // Extract summary - prioritizing the 'call_analytics' object seen in logs
                const analytics = data.call_analytics || {};
                const rawSummary = analytics.summary || data.summary || data.callSummary || '';
                const rawNextStep = analytics.next_step || data.next_step || '';
                
                // Run Gemini Analysis
                const analysis = await analyzeTranscriptWithGemini(transcriptText);
                
                // Final combined summary if we have custom fields but no transcript analysis
                let finalSummary = analysis.summary;
                if ((!finalSummary || finalSummary.includes("No transcript")) && rawSummary) {
                    finalSummary = rawSummary;
                }

                await docRef.update({
                    aiCallStatus: 'Completed',
                    aiTranscript: transcriptText,
                    aiSummary: finalSummary || '',
                    aiSuggestions: (analysis.suggestions && analysis.suggestions.length > 0) ? analysis.suggestions : (rawNextStep ? [rawNextStep] : []),
                    aiRecordingUrl: data.recording_url || data.recordingURL || '',
                    aiCallDuration: data.duration_seconds || data.durationSeconds || 0,
                    isAIPending: false,
                    updatedAt: new Date().toISOString()
                });
                
                // Now trigger the Wati Welcome sequence
                // We'll require index's sendLeadWelcomeSequence function indirectly, or we can just emit an event.
                // Since this is in functions, it might be cleaner to just let onOpportunityCreate handle it if we decouple,
                // but since onOpportunityCreate already ran, we should send it here.
                // Alternatively, we require index.js:
                try {
                    const { sendLeadWelcomeSequence } = require('./index');
                    // Find assigned name
                    const { USERS } = require('./index');
                    let assignedName = 'Our team';
                    if (USERS) {
                        const user = USERS.find(u => u.email.toLowerCase() === (oppData.owner || '').toLowerCase());
                        if (user) assignedName = user.name;
                    }
                    
                    if (oppData.phone || oppData.contactPhone) {
                        await sendLeadWelcomeSequence(oppData.phone || oppData.contactPhone, oppData.contactName || oppData.name, assignedName, docRef.id);
                    }
                } catch (watiErr) {
                    console.error('[Huskyvoice Webhook] Failed to send Wati welcome sequence:', watiErr);
                }
            } else {
                console.warn(`[Huskyvoice Webhook] No opportunity found for call_id ${callId}`);
            }
        } else if (event_type === 'call.failed' || event_type === 'call.disallowed') {
            // Handle failed calls
            console.log(`[Huskyvoice Webhook] Call failed/disallowed. Payload:`, JSON.stringify(data));
            const callId = data.call_id;
            const oppsSnap = await db.collection('opportunities')
                .where('aiCallId', '==', callId)
                .limit(1)
                .get();
                
            if (!oppsSnap.empty) {
                const docRef = oppsSnap.docs[0].ref;
                const oppData = oppsSnap.docs[0].data();
                
                await docRef.update({
                    aiCallStatus: 'Failed',
                    isAIPending: false,
                    updatedAt: new Date().toISOString()
                });
                
                // Fallback: Trigger Wati welcome sequence so lead isn't stuck
                try {
                    const { sendLeadWelcomeSequence, USERS } = require('./index');
                    let assignedName = 'Our team';
                    if (USERS) {
                        const user = USERS.find(u => u.email.toLowerCase() === (oppData.owner || '').toLowerCase());
                        if (user) assignedName = user.name;
                    }
                    if (oppData.phone || oppData.contactPhone) {
                        await sendLeadWelcomeSequence(oppData.phone || oppData.contactPhone, oppData.contactName || oppData.name, assignedName, docRef.id);
                        console.log(`[Huskyvoice Webhook] AI call failed, sent standard fallback welcome sequence to ${oppData.phone}`);
                    }
                } catch (watiErr) {
                    console.error('[Huskyvoice Webhook] Failed to send Wati welcome fallback:', watiErr);
                }
            }
        }
        
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('[Huskyvoice Webhook] Error:', error);
        // Always return 200 to prevent retries for unhandled errors
        return res.status(200).send('Error processed');
    }
});

// Cron Job: Process pending AI calls (e.g., from after hours) every 15 minutes during business hours
const processPendingAICalls = functions.pubsub.schedule('every 15 minutes').onRun(async (context) => {
    if (!isBusinessHours()) {
        console.log('[Pending AI Calls] Outside business hours, skipping.');
        return null;
    }
    
    const db = getDb();
    const snapshot = await db.collection('opportunities')
        .where('isAIPending', '==', true)
        .where('aiCallStatus', '==', 'Scheduled')
        .limit(10) // Process in small batches
        .get();
        
    console.log(`[Pending AI Calls] Found ${snapshot.size} pending calls to process.`);
    
    for (const doc of snapshot.docs) {
        const data = doc.data();
        await triggerHuskyvoiceCall(doc.id, data);
    }
    
    return null;
});

module.exports = {
    isBusinessHours,
    triggerHuskyvoiceCall,
    huskyvoiceWebhook,
    processPendingAICalls
};
