import { handleRequest } from "../src/handle_request.js";

export const config = {
  runtime: 'edge' // 告诉 Vercel 这是 Edge Function
};

export default async function handler(req) {
  const url = new URL(req.url);
  console.log('Request URL:', req.url);

  // 添加全局 API Key 验证
  const apiKey = req.headers.get("X-API-Key");
  const allowedKeys = process.env.ALLOWED_KEYS ? process.env.ALLOWED_KEYS.split(",") : [];
  if (!apiKey || !allowedKeys.includes(apiKey)) {
    return new Response(JSON.stringify({ error: "Invalid API Key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 验证通过，调用 handleRequest
  return await handleRequest(req);
}
