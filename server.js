import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
app.use(express.json());

// === ENV ===
const BP_API_BASE = process.env.BP_API_BASE || "https://api.botpress.cloud";
const BP_BOT_ID   = process.env.BP_BOT_ID;      // from your Botpress bot
const BP_TOKEN    = process.env.BP_TOKEN;       // your BP PAT
const RETELL_SIGNING_SECRET = process.env.RETELL_SIGNING_SECRET || "";

// === Helper: send user text to Botpress, get latest assistant reply ===
async function askBotpress({ sessionId, userText }) {
  // 1) Send the user's message to a Botpress conversation (keyed by sessionId)
  const post = await fetch(
    `${BP_API_BASE}/v1/bots/${BP_BOT_ID}/conversations/${sessionId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${BP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ type: "text", payload: { text: userText } })
    }
  );
  if (!post.ok) {
    const t = await post.text();
    throw new Error(`Botpress POST ${post.status}: ${t}`);
  }

  // 2) Pull the most recent assistant message
  const get = await fetch(
    `${BP_API_BASE}/v1/bots/${BP_BOT_ID}/conversations/${sessionId}/messages?limit=1&direction=desc`,
    { headers: { Authorization: `Bearer ${BP_TOKEN}` } }
  );
  const data = await get.json();
  const last = data?.messages?.[0];
  const reply =
    last?.payload?.text ||
    last?.payload?.payload?.text ||
    last?.payload?.message ||
    "Sorry, I didn’t catch that.";
  return reply;
}

// === Retell LLM Webhook endpoint ===
// Configure in Retell Agent: LLM/Server webhook -> POST https://<your-bridge-domain>/retell
app.post("/retell", async (req, res) => {
  try {
    // Optional: verify signature if enabled in Retell
    if (RETELL_SIGNING_SECRET && req.headers["x-retell-signature"]) {
      const sig = req.headers["x-retell-signature"];
      const h = crypto
        .createHmac("sha256", RETELL_SIGNING_SECRET)
        .update(JSON.stringify(req.body))
        .digest("hex");
      if (sig !== h) return res.status(401).send("bad signature");
    }

    // Use Retell call/session id as the Botpress conversation id
    const sessionId = String(
      req.body.sessionId ||
      req.body.callId ||
      req.body.conversationId ||
      req.body.session_id ||
      "default"
    );

    // Grab transcript text from the Retell payload
    const userText =
      req.body.text ||
      req.body.transcript ||
      req.body.latest_user_message ||
      req.body.message ||
      "";

    // Ignore non-text/noise events
    if (!userText.trim()) return res.json({ reply: "" });

    const reply = await askBotpress({ sessionId, userText });
    return res.json({ reply }); // Retell expects { reply: "..." }
  } catch (e) {
    console.error("RETELL webhook error:", e);
    return res.json({ reply: "I hit an issue reaching the assistant. Please try again." });
  }
});

// Health check
app.get("/health", (_, res) => res.send("ok"));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Bridge listening on " + port));
