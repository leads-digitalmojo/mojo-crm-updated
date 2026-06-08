const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
async function count() {
  const snap = await db.collection('opportunities').count().get();
  console.log("Total opportunities:", snap.data().count);
}
count().catch(console.error);
