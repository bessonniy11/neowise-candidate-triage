import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));
const allowedTopics = new Set(["delivery", "pricing", "other"]);

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function handleTriage(request, response) {
  let input;
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return json(response, 400, { status: "invalid_input" });
  }

  if (typeof input?.text !== "string" || !input.text.trim()) {
    return json(response, 400, { status: "invalid_input" });
  }

  const controller = new AbortController();
  let timer;
  try {
    const raw = await Promise.race([
      classify(input.text.trim(), { signal: controller.signal }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("AI response timed out"));
        }, 300);
      }),
    ]);

    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      !allowedTopics.has(parsed.topic) ||
      typeof parsed.draft !== "string" ||
      !parsed.draft.trim()
    ) {
      throw new Error("Invalid AI response");
    }

    return json(response, 200, {
      status: "ready",
      topic: parsed.topic,
      draft: parsed.draft.trim(),
    });
  } catch (error) {
    console.warn("[triage] AI fallback:", error.message);
    return json(response, 200, {
      status: "manual_review",
      topic: null,
      draft: null,
    });
  } finally {
    clearTimeout(timer);
  }
}

export const server = createServer(async (request, response) => {
  if (request.method === "GET" && (request.url === "/" || request.url === "/index.html")) {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }

  if (request.method !== "POST" || request.url !== "/api/triage") {
    return json(response, 404, { status: "not_found" });
  }
  try {
    await handleTriage(request, response);
  } catch (error) {
    console.error("[triage] Server error:", error);
    if (!response.headersSent) json(response, 500, { status: "server_error" });
  }
});

server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1");
