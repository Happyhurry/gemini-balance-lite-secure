// src/handle_request.js

import { handleVerification } from './verify_keys.js';
import openai from './openai.mjs';

export async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const search = url.search;

  // Debug 日志
  console.log('Incoming request URL:', request.url);
  console.log('Incoming headers:', JSON.stringify(Object.fromEntries(request.headers.entries())));
  
  // Paths 不需要 API-Key 验证
  if (pathname === '/' || pathname === '/index.html') {
    return new Response('Proxy is Running! More Details: https://github.com/tech-shrimp/gemini-balance-lite', {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  if (pathname === '/verify' && request.method === 'POST') {
    return handleVerification(request);
  }

  // 校验 api key
  const apiKeyHeader = request.headers.get("X-API-Key");
  const allowedKeysEnv = process.env.ALLOWED_KEYS || "";
  // 去掉可能的空格，让匹配更稳健
  const allowedKeys = allowedKeysEnv.split(",").map(k => k.trim()).filter(k => k);
  console.log('Allowed keys from env:', allowedKeys);
  console.log('X-API-Key from request:', apiKeyHeader);

  if (!apiKeyHeader || !allowedKeys.includes(apiKeyHeader)) {
    return new Response(JSON.stringify({ error: "Invalid API Key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 判断是否是 OpenAI 格式路径，比如兼容 OpenAI 的 /v1/... endpoints
  // 如果你只想支持 Gemini native 路径，这部分可以简化或移除
  // 这里支持 /v1/ 和 /v1beta/openai/ 两种 OpenAI 兼容路径
  if (
    (pathname.startsWith("/v1/") || pathname.startsWith("/v1beta/openai/")) &&
    (pathname.endsWith("/chat/completions") ||
      pathname.endsWith("/completions") ||
      pathname.endsWith("/embeddings") ||
      pathname.endsWith("/models"))
  ) {
    console.log('Routing to OpenAI-compatible path:', pathname);
    return openai.fetch(request);
  }

  // 否则视为 Gemini native 路径
  // 构造 target URL 到 Google Gemini 原生端点
  const targetUrl = `https://generativelanguage.googleapis.com${pathname}${search}`;
  console.log('Routing to Gemini native path:', targetUrl);

  // 从环境变量里取多个 Google API keys 用于 x-goog-api-key 轮询或随机
  const apiKeysEnv = process.env.API_KEYS || "";
  const geminiApiKeys = apiKeysEnv.split(",").map(k => k.trim()).filter(k => k);
  if (geminiApiKeys.length === 0) {
    console.error("No Gemini API keys configured");
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 可以随机选一个 key，也可以轮询（看你偏好）
  const selectedKey = geminiApiKeys[Math.floor(Math.random() * geminiApiKeys.length)];
  console.log('Selected Gemini key:', selectedKey);

  // 构造新的 headers 发给 google
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lower = key.trim().toLowerCase();
    if (lower === 'x-goog-api-key') {
      // ignore original x-goog key from user，准备用我们选的
      continue;
    }
    if (lower === 'content-type' || lower === 'accept') {
      // 保留这些 Header
      headers.set(key, value);
    }
    // 你可能还要保留其他 header，比如用户的用户代理、其他 metadata 看你需求
  }
  // 设置 x-goog-api-key 到选中的 Gemini API key
  headers.set("x-goog-api-key", selectedKey);

  // 发请求
  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body,
    });
    console.log('Gemini downstream response status:', response.status);

    // 复制 response headers 并清理一些
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('transfer-encoding');
    responseHeaders.delete('connection');
    responseHeaders.delete('keep-alive');
    responseHeaders.delete('content-encoding');
    responseHeaders.set('Referrer-Policy', 'no-referrer');

    const body = await response.arrayBuffer();  // 用 arrayBuffer 可以防止 stream/body 被消费问题
    return new Response(body, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (error) {
    console.error('Error forwarding to Gemini:', error);
    return new Response(JSON.stringify({ error: "Internal Server Error", details: error.stack }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
