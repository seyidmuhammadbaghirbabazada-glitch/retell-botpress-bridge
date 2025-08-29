import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import { WebSocketServer } from "ws";

const app = express();
app.use(express.json());

// === ENV ===
const BP_API_BASE = process.env.BP_API_BASE || "https://api.botpress.cloud";
const BP_BOT_ID   = process.env.BP_BOT_ID;
const BP_TOKEN    = process.env.BP_TOKEN;
const RETELL_SIGNING_SECRET = process.env.RETELL_SIGNING_SECRET || "";

// === Helper: send user text to Botpress, get latest assistant reply ===
async function askBotpress({ sessionId, userText }) {
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

// Simple health check (HTTP)
app.get("/health", (_, res) => res.send("ok"));

const port = process.env.PORT || 3000;
const server = app.listen(port, () => console.log("Bridge listening on " + port));

// === Retell Custom LLM expects a WebSocket endpoint at /retell ===
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/retell") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws, req) => {
  console.log("WS connected", req.headers["sec-websocket-key"]);

  ws.on("message", async (message) => {
    try {
      const evt = JSON.parse(message.toString());
      // Retell sends: { response_id, transcript: [{role:'agent'|'user', content}], interaction_type, session_id ... }
      const sessionId = String(
        evt.session_id || evt.sessionId || evt.callId || "default"
      );

      if (evt.interaction_type === "update_only") {
        // partial ASR updates; ignore
        return;
      }

      // Pick last user utterance from transcript
      const turns = Array.isArray(evt.transcript) ? evt.transcript : [];
      const lastUser = [...turns].reverse().find(t => t.role === "user")?.content || "";
      const userText = (lastUser || "").trim();

      let content;
      if (!userText) {
        // Startup / handshake: greet
        content = "Hi, I’m Kelsy with Helvetica Group. Are you a broker, or do you have general questions?";
        console.log("WS greet (no user text yet).");
      } else {
        content = await askBotpress({ sessionId, userText });
      }

      const res = {
        response_id: evt.response_id ?? 0,
        content,
        content_complete: true,
        end_call: false
      };
      ws.send(JSON.stringify(res));
      console.log("WS sent:", res);
    } catch (e) {
      console.error("WS error:", e);
      ws.send(JSON.stringify({
        response_id: 0,
        content: "I hit a temporary issue. Please try again.",
        content_complete: true,
        end_call: false
      }));
    }
  });

  ws.on("close", () => console.log("WS closed"));
});

