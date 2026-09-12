import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyRecallWebhook } from "./recall";

const secret = `whsec_${Buffer.from("local-check-key").toString("base64")}`;
const body = '{"event":"transcript.data"}';
const id = "msg_check";
const timestamp = "2";
const signature = createHmac("sha256", Buffer.from("local-check-key"))
  .update(`${id}.${timestamp}.${body}`)
  .digest("base64");
const headers = new Headers({
  "webhook-id": id,
  "webhook-timestamp": timestamp,
  "webhook-signature": `v1,${signature}`,
});

assert.equal(verifyRecallWebhook(body, headers, secret, 2), true);
assert.equal(verifyRecallWebhook(`${body} `, headers, secret, 2), false);
assert.equal(verifyRecallWebhook(body, headers, secret, 303), false);
console.log("Recall signature check passed");
