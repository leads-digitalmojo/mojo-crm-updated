const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

async function check() {
  const snapshot = await db.collection('processed_meta_leads').orderBy('processedAt', 'desc').limit(3).get();
  snapshot.forEach(doc => {
    console.log(doc.id, doc.data());
  });
}
check().catch(console.error);
