import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("an older response cannot replace a newer result on the page", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  // Run the actual inline UI handler with a minimal DOM/fetch stub.
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "The page must contain its submit handler");

  const field = { value: "" };
  const output = { textContent: "" };
  let onSubmit;
  const form = {
    addEventListener(name, callback) {
      assert.equal(name, "submit");
      onSubmit = callback;
    },
  };
  const requests = [];
  const document = {
    querySelector(selector) {
      return { form, "#message": field, "#result": output }[selector];
    },
  };
  const fetch = (_url, options) => new Promise((resolve) => {
    requests.push({ resolve, text: JSON.parse(options.body).text });
  });

  runInNewContext(script, { document, fetch });
  assert.equal(typeof onSubmit, "function");

  field.value = "Старый запрос";
  const oldSubmit = onSubmit({ preventDefault() {} });
  field.value = "Новый запрос";
  const newSubmit = onSubmit({ preventDefault() {} });

  assert.deepEqual(requests.map((request) => request.text), ["Старый запрос", "Новый запрос"]);
  requests[1].resolve({
    ok: true,
    status: 200,
    json: async () => ({ status: "ready", topic: "other", draft: "Новый черновик" }),
  });
  await newSubmit;
  assert.match(output.textContent, /Новый черновик/);
  const latestOutput = output.textContent;

  requests[0].resolve({
    ok: true,
    status: 200,
    json: async () => ({ status: "ready", topic: "other", draft: "Устаревший черновик" }),
  });
  await oldSubmit;
  assert.equal(output.textContent, latestOutput);
  assert.doesNotMatch(output.textContent, /Устаревший/);
});
