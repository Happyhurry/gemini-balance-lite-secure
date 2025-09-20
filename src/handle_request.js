// src/handle_request.js

import { handleVerification } from './verify_keys.js';
import openai from './openai.mjs';

export async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const search = url.search;

  console.log('Incoming request URL:', request.url);
  console.log('Incoming headers:', JSON.stringify(Object.fromEntries(request.headers.entries())));

  // 公开路径，不需要 API Key
  if (pathname === '/' || pathname === '/index.html') {
    return new Response('Proxy is Running! More Details: https://github.com/tech-shrimp/gemini-balance-lite', {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // verify endpoint 公开
  if (pathname === '/verify' && request.method === 'POST') {
    return handleVerification(request);
  }

  // 验证插件头部 X-API-Key
  const apiKeyHeader = request.headers.get("X-API-Key");
  const allowedKeysEnv = process.env.ALLOWED_KEYS || "";
  const allowedKeys = allowedKeysEnv.split(",").map(k => k.trim()).filter(k => k);

  console.log('Allowed keys from env:', allowedKeys);
  console.log('X-API-Key from request:', apiKeyHeader);

  if (!apiKeyHeader || !allowedKeys.includes(apiKeyHeader)) {
    return new Response(JSON.stringify({ error: "Invalid API Key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 判断是否是 OpenAI 兼容路径
  if (
    (pathname.startsWith("/v1/") || pathname.startsWith("/v1beta/openai/")) &&
    (pathname.endsWith("/chat/completions") ||
     pathname.endsWith("/completions") ||
     pathname.endsWith("/embeddings") ||
     pathname.endsWith("/models"))
  ) {
    console.log('Routing to OpenAI fetch for path:', pathname);
    return openai.fetch(request);
  }

  // 否则为 Gemini 原生路径
  const targetUrl = `https://generativelanguage.googleapis.com${pathname}${search}`;
  console.log('Routing to Gemini native path:', targetUrl);

  const apiKeysEnv = process.env.API_KEYS || "";
  const geminiApiKeys = apiKeysEnv.split(",").map(k => k.trim()).filter(k => k);
  if (geminiApiKeys.length === 0) {
    console.error("No Gemini API keys configured in API_KEYS");
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const selectedKey = geminiApiKeys[Math.floor(Math.random() * geminiApiKeys.length)];
  console.log('Selected Gemini API Key:', selectedKey);

  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lower = key.trim().toLowerCase();
    if (lower === 'x-goog-api-key') {
      continue;  // 我们用我们自己选的 key 替代
    }
    if (lower === 'content-type' || lower === 'accept') {
      headers.set(key, value);
    }
    // 如果你想保留其他头（例如 user-agent 或其他），可以加在这里
  }
  headers.set("x-goog-api-key", selectedKey);

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body,
    });

    console.log('Gemini downstream status:', response.status);

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('transfer-encoding');
    responseHeaders.delete('connection');
    responseHeaders.delete('keep-alive');
    responseHeaders.delete('content-encoding');
    responseHeaders.set('Referrer-Policy', 'no-referrer');

    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Error forwarding to Gemini:', error);
    return new Response(JSON.stringify({ error: "Internal Server Error", details: error.stack }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
