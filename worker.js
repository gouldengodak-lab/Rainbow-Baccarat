export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/leaderboard") {
      const corsHeaders = {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      };

      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }

      // Retrieve current leaderboard dictionary from KV
      const raw = await env.LEADERBOARD_KV.get("global_scores");
      const board = raw ? JSON.parse(raw) : {};

      if (request.method === "GET") {
        return new Response(JSON.stringify(Object.values(board)), {
          headers: corsHeaders
        });
      }

      if (request.method === "POST") {
        let entry;
        try {
          entry = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: corsHeaders
          });
        }

        if (!entry || !entry.playerId || !entry.username) {
          return new Response(JSON.stringify({ error: "Missing playerId or username" }), {
            status: 400,
            headers: corsHeaders
          });
        }

        const id = String(entry.playerId).trim().slice(0, 64);
        const cleanName = String(entry.username).trim().slice(0, 18);
        if (cleanName.length < 2) {
          return new Response(JSON.stringify({ error: "Username too short" }), {
            status: 400,
            headers: corsHeaders
          });
        }

        const existing = board[id] || {};
        board[id] = {
          id,
          playerId: id,
          username: cleanName,
          peakBalance: Math.max(
            Number(existing.peakBalance || 1000),
            Number(entry.peakBalance || 1000)
          ),
          currentBalance: Number(entry.currentBalance || 1000),
          netProfit: Number(entry.netProfit || 0),
          bestHandWin: Math.max(
            Number(existing.bestHandWin || 0),
            Number(entry.bestHandWin || 0)
          ),
          handsPlayed: Math.max(
            Number(existing.handsPlayed || 0),
            Number(entry.handsPlayed || 0)
          ),
          updatedAt: Date.now()
        };

        // Keep top 250 players by peakBalance so KV stays compact and fast
        const trimmed = Object.values(board)
          .sort((a, b) => (b.peakBalance || 0) - (a.peakBalance || 0))
          .slice(0, 250);

        const nextBoard = {};
        for (const item of trimmed) {
          nextBoard[item.id] = item;
        }

        // Store updated dictionary back into KV
        await env.LEADERBOARD_KV.put("global_scores", JSON.stringify(nextBoard));

        return new Response(JSON.stringify(trimmed), {
          headers: corsHeaders
        });
      }

      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: corsHeaders
      });
    }

    // Serve static files (index.html, etc.)
    return env.ASSETS.fetch(request);
  }
};
