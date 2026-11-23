import test, { after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

process.env.PORT = "0"; // Let the OS choose an available port.
const { server } = await import("../server.mjs");
if (!server.listening) await once(server, "listening");
const baseUrl = `http://127.0.0.1:${server.address().port}`;
after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

async function post(body, raw = false) {
  const response = await fetch(`${baseUrl}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? body : JSON.stringify(body),
  });
  return { code: response.status, data: await response.json() };
}

test("valid text returns a checked draft", async () => {
  assert.deepEqual(await post({ text: "Когда будет доставка заказа?" }), {
    code: 200,
    data: { status: "ready", topic: "delivery", draft: "Спасибо за обращение. Уточним детали заявки." },
  });
});

test("invalid input returns HTTP 400", async () => {
  for (const [body, raw] of [
    [{ text: "" }, false],
    [{ text: "  " }, false],
    [{ text: 123 }, false],
    [{ unexpected: "x" }, false],
    [null, false],
    ["{invalid", true],
  ]) {
    assert.deepEqual(await post(body, raw), { code: 400, data: { status: "invalid_input" } });
  }
});

test("model failures and invalid outputs trigger manual review", async () => {
  for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]", "[timeout]"]) {
    const start = Date.now();
    assert.deepEqual(await post({ text: `Заявка ${marker}` }), {
      code: 200,
      data: { status: "manual_review", topic: null, draft: null },
    });
    if (marker === "[timeout]") {
      assert.ok(Date.now() - start < 1_000, "Timeout must not wait for the full 1200ms mock");
    }
  }
});
