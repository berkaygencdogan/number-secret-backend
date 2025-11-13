const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("fs");

let serviceAccountPath =
  process.env.FIREBASE_CREDENTIALS_PATH ||
  "./plus-minus-game-firebase-adminsdk-gu30l-4a0400b6ba.json";

let serviceAccount;

try {
  serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  console.log(
    "✅ Firebase servis hesabı başarıyla yüklendi:",
    serviceAccountPath
  );
} catch (error) {
  console.error("❌ Firebase servis hesabı yüklenemedi:", error.message);
  process.exit(1); // Sunucu başlamasın
}

const app = initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore(app);

module.exports = { db };
