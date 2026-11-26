export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Cache-Control, Pragma",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "CDN-Cache-Control": "no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
      "Pragma": "no-cache",
      "Expires": "0"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Global High Score Database Endpoint
    if (url.pathname === "/api/leaderboard") {
      try {
        if (!env.LEADERBOARD_KV) {
          return new Response(
            JSON.stringify({ error: "LEADERBOARD_KV binding missing" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const DB_KEY = "global_high_scores_v1";
        const raw = await env.LEADERBOARD_KV.get(DB_KEY);
        let entries = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(entries)) entries = [];

        if (request.method === "GET") {
          return new Response(JSON.stringify(entries), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (request.method === "POST") {
          const body = await request.json();
          const playerId = String(body.playerId || "").trim().slice(0, 64);
          const username = String(body.username || "").trim().slice(0, 18);

          if (!playerId || !username) {
            return new Response(
              JSON.stringify({ error: "playerId and username required" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const incomingPeak = Number(body.peakBalance) || 1000;
          const incomingCurrent = Number(body.currentBalance) || 1000;
          const incomingNet = Number(body.netProfit) || 0;
          const incomingBest = Number(body.bestHandWin) || 0;
          const incomingHands = Math.max(0, Math.floor(Number(body.handsPlayed) || 0));

          const idx = entries.findIndex(
            (e) => e.id === playerId || e.playerId === playerId
          );

          if (idx >= 0) {
            const prev = entries[idx];
            // Never allow a lower/stale session to overwrite a higher all-time peak or hand count
            entries[idx] = {
              id: playerId,
              playerId: playerId,
              username: username,
              peakBalance: Math.max(Number(prev.peakBalance || 1000), incomingPeak),
              currentBalance: incomingHands >= (prev.handsPlayed || 0) ? incomingCurrent : prev.currentBalance,
              netProfit: incomingHands >= (prev.handsPlayed || 0) ? incomingNet : prev.netProfit,
              bestHandWin: Math.max(Number(prev.bestHandWin || 0), incomingBest),
              handsPlayed: Math.max(Number(prev.handsPlayed || 0), incomingHands),
              updatedAt: Date.now()
            };
          } else {
            entries.push({
              id: playerId,
              playerId: playerId,
              username: username,
              peakBalance: incomingPeak,
              currentBalance: incomingCurrent,
              netProfit: incomingNet,
              bestHandWin: incomingBest,
              handsPlayed: incomingHands,
              updatedAt: Date.now()
            });
          }

          // Keep top 250 players sorted by Peak Bankroll
          entries.sort((a, b) => (b.peakBalance || 0) - (a.peakBalance || 0));
          entries = entries.slice(0, 250);

          await env.LEADERBOARD_KV.put(DB_KEY, JSON.stringify(entries));

          return new Response(JSON.stringify(entries), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err.message || "KV Database Error" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Serve static assets (index.html, etc.) with no-cache on HTML so updates load immediately
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (url.pathname === "/" || url.pathname.endsWith(".html")) {
        const freshHeaders = new Headers(assetResponse.headers);
        freshHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate");
        return new Response(assetResponse.body, {
          status: assetResponse.status,
          statusText: assetResponse.statusText,
          headers: freshHeaders
        });
      }
      return assetResponse;
    }

    return new Response("Not Found", { status: 404 });
  }
};
