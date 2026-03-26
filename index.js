import express from "express";
import dotenv from "dotenv";
import { Resend } from "resend";
import admin from "firebase-admin";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;

// 🔑 ENV VARIABLES
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;
const RESEND_FROM_NAME = process.env.RESEND_FROM_NAME || "Quiz Game";

console.log("🔑 API KEY:", RESEND_API_KEY ? "Loaded ✅" : "Missing ❌");
console.log("📧 FROM EMAIL:", RESEND_FROM_EMAIL);

// 🔥 Firebase init
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!serviceAccountJson) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT_JSON missing");
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountJson);
} catch (err) {
  console.error("❌ Invalid Firebase JSON");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// 🔴 Resend check
if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
  console.error("❌ Resend not configured properly");
  process.exit(1);
}

const resend = new Resend(RESEND_API_KEY);

// 🌍 CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// 🟢 Root
app.get("/", (req, res) => {
  res.send("Server is running ✅");
});

// 🧪 TEST EMAIL ROUTE (IMPORTANT)
app.get("/test-email", async (req, res) => {
  try {
    const response = await resend.emails.send({
      from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
      to: ["afridchand@gmail.com"], // 👈 yaha apna email daal
      subject: "Test Email ✅",
      html: "<h1>Resend working 🚀</h1>"
    });

    console.log("📩 Test Response:", response);
    res.send("Email sent ✅");
  } catch (err) {
    console.error("❌ Test Error:", err);
    res.send("Error ❌");
  }
});

// 🔐 OTP Config
const EMAIL_REGEX = /^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+$/;
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const hashCode = (code) =>
  crypto.createHash("sha256").update(code).digest("hex");

const generateOtp = () =>
  String(100000 + Math.floor(Math.random() * 900000));

// 📩 Send Email
async function sendOtpEmail(email, code) {
  console.log("📨 Sending OTP to:", email);

  const result = await resend.emails.send({
    from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
    to: [email],
    subject: "Your Quiz Game OTP",
    html: `<h2>Your OTP is: ${code}</h2><p>Valid for 5 minutes</p>`
  });

  console.log("📩 Resend response:", result);

  if (result.error) {
    throw new Error(result.error.message || "Email send failed");
  }
}

// ✅ SEND OTP
app.post("/otp/send", async (req, res) => {
  try {
    const email = (req.body?.email || "").trim().toLowerCase();

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ success: false, message: "Valid email required" });
    }

    const code = generateOtp();

    await db.collection("otp_requests").doc(email).set({
      codeHash: hashCode(code),
      attempts: 0,
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_MS),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await sendOtpEmail(email, code);

    res.json({ success: true, message: "OTP sent ✅" });

  } catch (err) {
    console.error("❌ OTP send error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ VERIFY OTP
app.post("/otp/verify", async (req, res) => {
  try {
    const email = (req.body?.email || "").trim().toLowerCase();
    const code = (req.body?.code || "").trim();

    if (!EMAIL_REGEX.test(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, message: "Invalid email or OTP" });
    }

    const docRef = db.collection("otp_requests").doc(email);
    const snap = await docRef.get();

    if (!snap.exists) {
      return res.status(400).json({ success: false, message: "No OTP found" });
    }

    const data = snap.data();

    if (data.expiresAt.toMillis() < Date.now()) {
      await docRef.delete();
      return res.status(400).json({ success: false, message: "OTP expired" });
    }

    if (data.attempts >= MAX_ATTEMPTS) {
      await docRef.delete();
      return res.status(400).json({ success: false, message: "Too many attempts" });
    }

    const isValid = data.codeHash === hashCode(code);

    await docRef.update({ attempts: data.attempts + 1 });

    if (!isValid) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    await docRef.delete();

    res.json({ success: true, message: "OTP verified ✅" });

  } catch (err) {
    console.error("❌ OTP verify error:", err);
    res.status(500).json({ success: false, message: "Verification failed" });
  }
});

// ❤️ Health check
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// 🚀 Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
