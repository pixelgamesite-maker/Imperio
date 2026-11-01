"use strict";
process.env.SECRET = process.env.SECRET || "test-secret-test-secret-test-secret-123";
process.env.BASE_URL = "https://bulk.example.com";
const test = require("node:test");
const assert = require("node:assert");
const { parseRecipients, personalize, unsubscribeUrl, verifyUnsubscribe, isEmail } = require("../src/util");

test("parses names, duplicates, invalid and suppressed addresses", () => {
  const text = "ada@example.com, Ada\nADA@example.com\nnot-an-email\nTunde <tunde@example.com>\nkemi@example.com;Kemi\n\nbo@example.com\tBo";
  const p = parseRecipients(text, new Set(["kemi@example.com"]));
  assert.deepStrictEqual(p.ready.map((r) => [r.email, r.name]), [["ada@example.com", "Ada"], ["tunde@example.com", "Tunde"], ["bo@example.com", "Bo"]]);
  assert.strictEqual(p.duplicate.length, 1);
  assert.strictEqual(p.invalid.length, 1);
  assert.strictEqual(p.suppressed[0].email, "kemi@example.com");
});

test("{name} falls back to there", () => {
  assert.strictEqual(personalize("Hi {name}!", "Ada"), "Hi Ada!");
  assert.strictEqual(personalize("Hi {NAME}!", ""), "Hi there!");
});

test("unsubscribe links verify and reject tampering", () => {
  const url = new URL(unsubscribeUrl("Ada@Example.com"));
  assert.strictEqual(verifyUnsubscribe(url.searchParams.get("e"), url.searchParams.get("t")), "ada@example.com");
  assert.strictEqual(verifyUnsubscribe(url.searchParams.get("e"), "x" + url.searchParams.get("t").slice(1)), null);
  assert.strictEqual(verifyUnsubscribe(Buffer.from("other@example.com").toString("base64url"), url.searchParams.get("t")), null);
});

test("email validation", () => {
  assert.ok(isEmail("mateo@orvellaz.xyz"));
  assert.ok(!isEmail("bola@gmail"));
  assert.ok(!isEmail("a b@example.com"));
});
