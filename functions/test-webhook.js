const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  const docRef = db.collection('opportunities').doc();
  await docRef.set({
    name: "Test User From Terminal",
    email: "terminal.test@example.com",
    phone: "+15555555555",
    stage: "New",
    source: "Manual Test",
    createdAt: new Date().toISOString()
  });
  console.log("Created test opportunity with ID:", docRef.id);
  process.exit(0);
}
run();
