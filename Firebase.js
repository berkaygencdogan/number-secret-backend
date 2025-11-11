const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("fs");

// 🔹 Render ortamında dosya /etc/secrets altında
const serviceAccountPath =
  process.env.FIREBASE_CREDENTIALS_PATH ||
  "/etc/secrets/plus-minus-game-firebase-adminsdk-gu30l-4a0400b6ba.json";

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

const app = initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore(app);

module.exports = { db };
