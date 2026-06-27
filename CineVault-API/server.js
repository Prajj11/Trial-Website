import http from "node:http";
import worker from "./index.js";

const PORT = process.env.PORT ?? 4000;

// --- Node version check ---
// duplex: "half" in Request requires Node 18+. Fail fast with a clear message
// instead of crashing with a cryptic error at runtime.
const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor < 18) {
  console.error(
    `\n  ❌ CineVault API requires Node.js 18 or later (found v${process.versions.node}).` +
    `\n     Please upgrade: https://nodejs.org/\n`
  );
  process.exit(1);
}

async function nodeToRequest(req) {
  const host = req.headers["host"]
    ?? (req.socket ? `localhost:${req.socket.localPort || PORT}` : `localhost:${PORT}`);
  const url = `http://${host}${req.url}`;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : null;
  const hasBody = body?.length > 0;

  const init = {
    method: req.method,
    headers: req.headers,
    body: hasBody ? body : undefined,
  };

  // duplex: "half" is only required (and only valid) when a body is present.
  // Setting it unconditionally breaks on Node versions that don't expect it
  // for bodyless requests.
  if (hasBody) {
    init.duplex = "half";
  }

  return new Request(url, init);
}

const server = http.createServer(async (req, res) => {
  console.log(`→ ${req.method} ${req.url}`);
  try {
    const request  = await nodeToRequest(req);
    const response = await worker.fetch(request, {});

    res.statusCode = response.status;
    for (const [k, v] of response.headers) res.setHeader(k, v);

    const buf = await response.arrayBuffer();
    res.end(Buffer.from(buf));
  } catch (err) {
    console.error("Unhandled error:", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`CineVault API server running at http://localhost:${PORT}`);
  console.log(`  GET /map/:anilistId`);
  console.log(`  GET /episodes/:anilistId`);
  console.log(`  GET /watch/animepahe/:id/sub|dub/animepahe-:ep`);

  console.log(`  GET /watch/reanime/:id/sub|dub/reanime-:ep`);
  console.log(`  GET /watch/anikoto/:id/sub|dub/anikoto-:ep`);
  console.log(`  GET /watch/animegg/:id/sub|dub/animegg-:ep`);
  console.log(`  GET /watch/anineko/:id/sub|dub/anineko-:ep`);
});
