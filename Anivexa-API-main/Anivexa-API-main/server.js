import http from "node:http";
import worker from "./index.js";

const PORT = process.env.PORT ?? 4000;

async function nodeToRequest(req) {
  const host = req.headers["host"] ?? `localhost:${PORT}`;
  const url = `http://${host}${req.url}`;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : null;

  return new Request(url, {
    method: req.method,
    headers: req.headers,
    body: body?.length ? body : undefined,
    duplex: "half",
  });
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
  console.log(`api-vexa dev server running at http://localhost:${PORT}`);
  console.log(`  GET /map/:anilistId`);
  console.log(`  GET /episodes/:anilistId`);
  console.log(`  GET /watch/animepahe/:id/sub|dub/animepahe-:ep`);
  console.log(`  GET /watch/allmanga/:id/sub|dub/allmanga-:ep`);
  console.log(`  GET /watch/reanime/:id/sub|dub/reanime-:ep`);
  console.log(`  GET /watch/anikoto/:id/sub|dub/anikoto-:ep`);
  console.log(`  GET /watch/animegg/:id/sub|dub/animegg-:ep`);
  console.log(`  GET /watch/anineko/:id/sub|dub/anineko-:ep`);
  console.log(`  GET /watch/anidbapp/:id/sub|dub/anidbapp-:ep`);
});
