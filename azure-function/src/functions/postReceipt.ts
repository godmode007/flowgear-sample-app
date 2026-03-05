import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

const FLOWGEAR_API_BASE = process.env.FLOWGEAR_API_BASE ?? "";
const FLOWGEAR_API_TOKEN = process.env.FLOWGEAR_API_TOKEN ?? "";

async function handler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (request.method !== "POST") {
    return { status: 405, jsonBody: { error: "Method not allowed" } };
  }

  if (!FLOWGEAR_API_BASE || !FLOWGEAR_API_TOKEN) {
    context.error("FLOWGEAR_API_BASE and FLOWGEAR_API_TOKEN must be set.");
    return {
      status: 500,
      jsonBody: { error: "Server not configured. Set FLOWGEAR_API_BASE and FLOWGEAR_API_TOKEN." },
    };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: "Invalid JSON body" } };
  }

  const url = `${FLOWGEAR_API_BASE.replace(/\/$/, "")}/v2/ProcurementInbound`;
  context.log("Forwarding POST to", url);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FLOWGEAR_API_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let responseBody: unknown = text;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") && text) {
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = text;
    }
  }

  return {
    status: res.status,
    headers: { "Content-Type": "application/json" },
    jsonBody: {
      responseCode: String(res.status),
      responseMessage: res.ok ? "Success" : text || res.statusText,
      success: res.ok,
      ...(typeof responseBody === "object" && responseBody !== null ? (responseBody as Record<string, unknown>) : {}),
    },
  };
}

app.http("postReceipt", {
  methods: ["POST"],
  route: "post-receipt",
  authLevel: "anonymous",
  handler,
});
