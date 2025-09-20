import { handleVerification } from './verify_keys.js';
import openai from './openai.mjs';

export async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const search = url.search;

  console.log('Incoming Headers:', JSON.stringify(Object.fromEntries(request.headers.entries())));

  // 公开路径：根路径
  if (pathname === '/' || pathname === '/index.html') {
    return new Response('Proxy is Running! More Details: https://github.com/tech-shrimp/gemini-balance-lite', {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // 公开路径：/verify POST
  if (pathname === '/verify' && request.method === 'POST') {
    return handleVerification(request);
  }

  // API Key 验证
  const apiKey = request.headers.get("X-API-Key");
  const allowedKeys = process.env.ALLOWED_KEYS ? process.env.ALLOWED_KEYS.split(",") : [];
  if (!apiKey || !allowedKeys.includes(apiKey)) {
    return new Response(JSON.stringify({ error: "Invalid API Key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // OpenAI 路径：精确匹配 /v1/ 前缀
  if (url.pathname.startsWith("/v1/") && 
      (url.pathname.endsWith("/chat/completions") || url.pathname.endsWith("/completions") || 
       url.pathname.endsWith("/embeddings") || url.pathname.endsWith("/models"))) {
    console.log('Routing to OpenAI path:', pathname);
    return openai.fetch(request);
  }

  // Gemini 原生路径
  const targetUrl = `https://generativelanguage.googleapis.com${pathname}${search}`;
  console.log('Routing to Gemini path:', targetUrl);

  try {
    const headers = new Headers();
    for (const [key, value] of request.headers.entries()) {
      if (key.trim().toLowerCase() === 'x-goog-api-key') {
        const apiKeys = value.split(',').map(k => k.trim()).filter(k => k);
        console.log('API Keys after split and trim:', apiKeys);
        if (apiKeys.length > 0) {
          const selectedKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];
          console.log(`Gemini Selected API Key: ${selectedKey}`);
          headers.set('x-goog-api-key', selectedKey);
        } else {
          console.log('No valid API Keys found in header');
        }
      } else if (key.trim().toLowerCase() === 'content-type') {
        headers.set(key, value);
      }
    }

    console.log('Forwarding Headers to Gemini:', JSON.stringify(Object.fromEntries(headers.entries())));

    const response = await fetch(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body
    });

    console.log('Call Gemini Success, Status:', response.status);

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('transfer-encoding');
    responseHeaders.delete('connection');
    responseHeaders.delete('keep-alive');
    responseHeaders.delete('content-encoding');
    responseHeaders.set('Referrer-Policy', 'no-referrer');

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });

  } catch (error) {
    console.error('Failed to fetch:', error);
    return new Response('Internal Server Error\n' + error?.stack, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};
