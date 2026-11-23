import crypto from "node:crypto";
import { createApp } from "./core.js";
import { createDynamoStore } from "./store-dynamo.js";

const ORIGIN_SECRET = process.env.ORIGIN_SECRET || "";

const handle = createApp({
  store: createDynamoStore({
    nominations: process.env.NOMINATIONS_TABLE,
    signups: process.env.SIGNUPS_TABLE,
    summaries: process.env.SUMMARIES_TABLE,
  }),
  adminPassword: process.env.ADMIN_PASSWORD || "",
});

function fromCloudFront(headers) {
  if (!ORIGIN_SECRET) return true;
  const given = crypto.createHash("sha256").update(headers["x-origin-verify"] || "").digest();
  const expected = crypto.createHash("sha256").update(ORIGIN_SECRET).digest();
  return crypto.timingSafeEqual(given, expected);
}

// API Gateway HTTP API (payload format 2.0) adapter.
export async function handler(event) {
  const headers = event.headers || {};
  if (!fromCloudFront(headers)) {
    return { statusCode: 403, headers: { "Content-Type": "text/plain" }, body: "Forbidden" };
  }

  const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body) : "";
  const res = await handle({
    method: event.requestContext.http.method,
    path: event.rawPath,
    headers,
    body,
    ip: headers["x-viewer-ip"] || event.requestContext.http.sourceIp,
  });
  return { statusCode: res.status, headers: res.headers, body: res.body };
}
