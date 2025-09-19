import { handleVerification } from './verify_keys.js';
import openai from './openai.mjs';

export async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const search = url.search;

  // 公开路径：根路径，不需要 API Key
  if (pathname === '/' || pathname === '/index.html') {
    return new Response('Proxy is Running!  More Details: https://github.com/tech-shrimp/gemini-balance-lite', {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // 公开路径：/verify POST 请求，不需要 API Key（假设这是验证工具）
  if (pathname === '/verify' && request.method === 'POST') {
    return handleVerification(request);
  }

  // 从这里开始，对其他路径添加 API Key 验证（保护代理 API）
  const apiKey = request.headers.get("X-API-Key");
  const allowedKeys = process.env.ALLOWED_KEYS ? process.env.ALLOWED_KEYS.split(",") : [];
  if (!apiKey || !allowedKeys.includes(apiKey)) {
    return new Response(JSON.stringify({ error: "Invalid API Key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 处理OpenAI格式请求
  if (url.pathname.endsWith("/chat/completions") || url.pathname.endsWith("/completions") || url.pathname.endsWith("/embeddings") || url.pathname.endsWith("/models")) {
    return openai.fetch(request);
  }

  const targetUrl = `https://generativelanguage.googleapis.com${pathname}${search}`;

  try {
    const headers = new Headers();
    for (const [key, value] of request.headers.entries()) {
      if (key.trim().toLowerCase() === 'x-goog-api-key') {
        const apiKeys = value.split(',').map(k => k.trim()).filter(k => k);
        if (apiKeys.length > 0) {
          const selectedKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];
          console.log(`Gemini Selected API Key: ${selectedKey}`);
          headers.set('x-goog-api-key', selectedKey);
        }
      } else {
        if (key.trim().toLowerCase() === 'content-type') {
          headers.set(key, value);
        }
      }
    }

    console.log('Request Sending to Gemini')
    console.log('targetUrl:' + targetUrl)
    console.log(headers)

    const response = await fetch(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body
    });

    console.log("Call Gemini Success")

    const responseHeaders = new Headers(response.headers);

    console.log('Header from Gemini:')
    console.log(responseHeaders)

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
