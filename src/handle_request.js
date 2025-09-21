// src/handle_request.js

import { handleVerification } from './verify_keys.js';
import openai from './openai.mjs';

export async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const search = url.search;

  console.log('Incoming request URL:', request.url);
  console.log('Incoming headers:', JSON.stringify(Object.fromEntries(request.headers.entries())));

  // 对根目录或 index 显示状态
  if (pathname === '/' || pathname === '/index.html') {
    return new Response(
      'Proxy is Running! More Details: https://github.com/tech-shrimp/gemini-balance-lite',
      {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      }
    );
  }

  // /verify POST 公开
  if (pathname === '/verify' && request.method === 'POST') {
    return handleVerification(request);
  }

  // ====== 身份 / 密钥 验证部分 ======
  // 支持 X-API-Key 或 Authorization: Bearer <key>
  let authKey = request.headers.get('X-API-Key');

  const authHeader = request.headers.get('Authorization');
  if (!authKey && authHeader && authHeader.startsWith('Bearer ')) {
    authKey = authHeader.substring('Bearer '.length).trim();
  }

  const allowedKeysEnv = process.env.ALLOWED_KEYS || '';
  const allowedKeys = allowedKeysEnv
    .split(',')
    .map(k => k.trim())
    .filter(k => k);

  console.log('Allowed keys from env:', allowedKeys);
  console.log('Received auth key:', authKey);

  if (!authKey || !allowedKeys.includes(authKey)) {
    return new Response(
      JSON.stringify({ error: 'Invalid API Key' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  // ====== 通过验证后，处理模型 / 路径 路由 ======

  // 如果是 OpenAI 兼容路径
  if (
    (pathname.startsWith('/v1/') || pathname.startsWith('/v1beta/openai/')) &&
    (pathname.endsWith('/chat/completions') ||
     pathname.endsWith('/completions') ||
     pathname.endsWith('/embeddings') ||
     pathname.endsWith('/models'))
  ) {
    console.log('Routing to OpenAI fetch for path:', pathname);
    return openai.fetch(request);
  }

  // 否则走 Gemini 原生路径
  const targetUrl = `https://generativelanguage.googleapis.com${pathname}${search}`;
  console.log('Routing to Gemini native path:', targetUrl);

  const apiKeysEnv = process.env.API_KEYS || '';
  const geminiApiKeys = apiKeysEnv
    .split(',')
    .map(k => k.trim())
    .filter(k => k);

  if (geminiApiKeys.length === 0) {
    console.error('No Gemini API keys configured in API_KEYS');
    return new Response(
      JSON.stringify({ error: 'Server misconfiguration: no Gemini API keys' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  const selectedKey = geminiApiKeys[Math.floor(Math.random() * geminiApiKeys.length)];
  console.log('Selected Gemini API Key:', selectedKey);

  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lower = key.trim().toLowerCase();

    if (lower === 'x-goog-api-key') {
      continue; // 用我们挑选的替代
    }
    if (lower === 'content-type' || lower === 'accept') {
      headers.set(key, value);
    }
    // 如果你需要保留其他头（比如 user-agent 等），可以在这里加条件
  }

  headers.set('x-goog-api-key', selectedKey);

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body
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
      headers: responseHeaders
    });
  } catch (error) {
    console.error('Error forwarding to Gemini:', error);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error', details: error?.stack }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
