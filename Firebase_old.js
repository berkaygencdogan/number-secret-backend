const admin = require("firebase-admin");
const serviceAccount = require("./plus-minus-game-firebase-adminsdk-gu30l-4a0400b6ba.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };
