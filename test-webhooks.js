const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // Might not exist, let's just use default if possible or project ID

admin.initializeApp({
  projectId: "leads-digitalmojo"
});

async function run() {
  const db = admin.firestore();
  const snapshot = await db.collection('webhooks').get();
  snapshot.forEach(doc => {
    console.log(doc.id, '=>', doc.data());
  });
}
run();
