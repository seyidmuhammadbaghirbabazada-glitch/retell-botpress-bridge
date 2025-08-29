// === Retell LLM Webhook endpoint ===
app.post("/retell", async (req, res) => {
  try {
    console.log("RETELL HIT keys:", Object.keys(req.body || {}));

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

    // Try multiple common fields for transcript text
    const userText =
      req.body.text ||
      req.body.transcript ||
      req.body.user_input ||
      (Array.isArray(req.body.messages) ? req.body.messages.at(-1)?.content : "") ||
      req.body.latest_user_message ||
      req.body.message ||
      "";

    // If Retell sends a startup/handshake event with no user text, greet
    if (!String(userText).trim()) {
      const greet = "Hi, I’m Mila with Helvetica Group. Are you a broker, or do you have general questions?";
      console.log("RETELL greet (no text in payload).");
      return res.type("text/plain").send(greet);
    }

    const reply = await askBotpress({ sessionId, userText });
    console.log("RETELL reply:", reply);
    return res.type("text/plain").send(reply); // <-- PLAIN TEXT
  } catch (e) {
    console.error("RETELL webhook error:", e);
    return res.type("text/plain").send(
      "I hit an issue reaching the assistant. Please try again."
    );
  }
});

