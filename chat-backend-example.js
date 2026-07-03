// chat-backend-example.js
//
// A minimal Cloudflare Worker that gives Exhale's chat REAL AI replies,
// instead of the built-in local fallback responses.
//
// WHY THIS FILE EXISTS
// The landing page (exhale-landing.html) is a static file. It can be hosted
// anywhere for free and used by anyone — but a static file can never hold a
// secret API key safely, because anyone can open dev tools and read it.
// This worker sits in between: the frontend calls YOUR worker, and only the
// worker (running on Cloudflare's servers, never in the visitor's browser)
// holds the real Anthropic API key.
//
//   Visitor's browser → your Worker (holds the key) → Anthropic API
//
// SETUP (free to start — Cloudflare's free tier covers a lot of usage)
// 1. npm install -g wrangler
// 2. wrangler login
// 3. wrangler init exhale-chat        (choose "Hello World" worker, JavaScript)
// 4. Replace the generated index.js with this file's contents
// 5. wrangler secret put ANTHROPIC_API_KEY     (paste your key when prompted)
// 6. wrangler deploy
// 7. Copy the deployed URL (looks like https://exhale-chat.YOURNAME.workers.dev)
//    into the CHAT_API_ENDPOINT constant near the top of the chat script in
//    exhale-landing.html. That's the only change needed on the frontend side.
//
// COST NOTE
// Every message a visitor sends triggers one real API call, which costs a
// small amount. For a free, public, no-login tool, add rate limiting (see
// the note at the bottom) before sharing this widely — otherwise usage, and
// your bill, has no ceiling. Start with a low daily/IP cap and raise it once
// you know your real traffic.

export default {
  async fetch(request, env) {
    // Basic CORS so your frontend (hosted elsewhere) can call this worker.
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*', // tighten to your real domain before going live
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== 'POST') {
      return new Response('Use POST', { status: 405, headers: corsHeaders });
    }

    let message;
    try {
      const body = await request.json();
      message = body.message;
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (!message || typeof message !== 'string' || message.length > 1000) {
      return new Response(JSON.stringify({ error: 'Invalid message' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // This keeps the model's behavior consistent with the rules in the
    // original design brief: supportive, non-diagnostic, no medical claims.
    // Real crisis handling still happens in the browser BEFORE this worker
    // is ever called (see exhale-landing.html) — this system prompt is a
    // second layer of safety, not the only one.
    const systemPrompt = `You are a warm, calm wellness companion inside a
free mental wellness app called Exhale. You are NOT a doctor, therapist,
psychologist, or psychiatrist, and you never diagnose or give medical advice.
Respond with empathy, ask gentle follow-up questions, and offer simple
grounding techniques (breathing, journaling, reframing) when they fit. Keep
replies short: 2 to 4 sentences. Use plain, human language. No clinical
terms, no emojis. If someone expresses thoughts of self-harm or suicide,
respond calmly, encourage them to contact local emergency services or a
crisis line, and gently point them toward Exhale's "Find professional help
near you" feature.`;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: message }],
      }),
    });

    if (!anthropicRes.ok) {
      return new Response(JSON.stringify({ error: 'Companion is unavailable right now' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const data = await anthropicRes.json();
    const reply =
      (data.content && data.content[0] && data.content[0].text) ||
      "I'm here, but having trouble responding right now — mind trying again?";

    return new Response(JSON.stringify({ reply }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  },
};

// -----------------------------------------------------------------------
// RATE LIMITING (add before going public)
// -----------------------------------------------------------------------
// Cloudflare gives you a free KV namespace you can use to track requests per
// visitor and cap them, e.g. 20 messages per hour per IP. Rough shape:
//
//   const ip = request.headers.get('CF-Connecting-IP');
//   const key = `rl:${ip}`;
//   const count = parseInt((await env.RATE_LIMIT_KV.get(key)) || '0', 10);
//   if (count >= 20) {
//     return new Response(JSON.stringify({ error: 'Too many messages, try again later' }), { status: 429 });
//   }
//   await env.RATE_LIMIT_KV.put(key, String(count + 1), { expirationTtl: 3600 });
//
// You'd bind a KV namespace to the worker (wrangler.toml) and create it with
// `wrangler kv namespace create RATE_LIMIT_KV` first.
