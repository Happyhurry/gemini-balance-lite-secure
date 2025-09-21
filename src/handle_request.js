// src/handle_request.js

import { handleVerification } from './verify_keys.js';
import openai from './openai.mjs';

export async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const search = url.search;

  console.log('Incoming request URL:', request.url);
  console.log('Incoming headers:', JSON.stringify(Object.fromEntries(request.headers.entries())));

  // 根目录或 index 显示状态
  if (pathname === '/' || pathname === '/index.html') {
    return new Response(
      'Proxy is Running! More Details: https://github.com/tech-shrimp/gemini-balance-lite',
      {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      }
    );
  }

  // /verify 公开端点
  if (pathname === '/verify' && request.method === 'POST') {
    return handleVerification(request);
  }

  // —— 身份验证部分 —— 支持 X-API-Key、Authorization: Bearer ..., 或 x-goog-api-key
  let authKey = request.headers.get('X-API-Key');

  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  if (!authKey && authHeader && authHeader.startsWith('Bearer ')) {
    authKey = authHeader.substring('Bearer '.length).trim();
  }

  if (!authKey) {
    const googKey = request.headers.get('x-goog-api-key');
    if (googKey) {
      authKey = googKey.trim();
    }
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

  // —— 路径判断 —— OpenAI 风格路径
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

  // —— 特殊 Gemini 路径处理 —— 修正 model:action 路径到标准 Gemini API 路径
  if (
    pathname.includes(':') &&
    (pathname.toLowerCase().includes('streamgeneratecontent') || pathname.toLowerCase().includes('generatecontent'))
  ) {
    console.log('Routing to Gemini native (special path) for path:', pathname);
    // 假设路径形如 "/{model}:{action}"
    const parts = pathname.split(':');
    let modelPart = parts[0].startsWith('/') ? parts[0].substring(1) : parts[0];
    const actionPart = parts[1];  // e.g. "streamGenerateContent" 或 "generateContent"
    const fixedPath = `/v1beta/models/${modelPart}:${actionPart}`;

    const newTargetUrl = `https://generativelanguage.googleapis.com${fixedPath}${search}`;
    console.log('FixedTargetUrl:', newTargetUrl);

    // 使用 Gemini key 列表
    const apiKeysEnv = process.env.API_KEYS || '';
    const geminiApiKeys = apiKeysEnv
      .split(',')
      .map(k => k.trim())
      .filter(k => k);
    if (geminiApiKeys.length === 0) {
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

    const headers2 = new Headers();
    for (const [key, value] of request.headers.entries()) {
      const lower = key.trim().toLowerCase();
      if (lower === 'x-goog-api-key') continue;  // 我们用新的
      if (lower === 'content-type' || lower === 'accept') {
        headers2.set(key, value);
      }
    }
    headers2.set('x-goog-api-key', selectedKey);

    try {
      const response2 = await fetch(newTargetUrl, {
        method: request.method,
        headers: headers2,
        body: request.body
      });
      console.log('Gemini downstream status (special path):', response2.status);

      const responseHeaders2 = new Headers(response2.headers);
      responseHeaders2.delete('transfer-encoding');
      responseHeaders2.delete('connection');
      responseHeaders2.delete('keep-alive');
      responseHeaders2.delete('content-encoding');
      responseHeaders2.set('Referrer-Policy', 'no-referrer');

      const bodyBuffer2 = await response2.arrayBuffer();
      return new Response(bodyBuffer2, {
        status: response2.status,
        headers: responseHeaders2
      });
    } catch (err) {
      console.error('Error forwarding corrected Gemini path:', err);
      return new Response(
        JSON.stringify({ error: 'Internal Server Error', details: err?.stack }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  }

  // —— 默认 Gemini 原生路径 —— 非 OpenAI 路径，也非特例路径
  {
    const targetUrl = `https://generativelanguage.googleapis.com${pathname}${search}`;
    console.log('Routing to Gemini native default path:', targetUrl);

    const apiKeysEnv = process.env.API_KEYS || '';
    const geminiApiKeys = apiKeysEnv
      .split(',')
      .map(k => k.trim())
      .filter(k => k);
    if (geminiApiKeys.length === 0) {
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

    const headers3 = new Headers();
    for (const [key, value] of request.headers.entries()) {
      const lower = key.trim().toLowerCase();
      if (lower === 'x-goog-api-key') continue;
      if (lower === 'content-type' || lower === 'accept') {
        headers3.set(key, value);
      }
    }
    headers3.set('x-goog-api-key', selectedKey);

    try {
      const response3 = await fetch(targetUrl, {
        method: request.method,
        headers: headers3,
        body: request.body
      });
      console.log('Gemini downstream status (default):', response3.status);

      const responseHeaders3 = new Headers(response3.headers);
      responseHeaders3.delete('transfer-encoding');
      responseHeaders3.delete('connection');
      responseHeaders3.delete('keep-alive');
      responseHeaders3.delete('content-encoding');
      responseHeaders3.set('Referrer-Policy', 'no-referrer');

      const bodyBuffer3 = await response3.arrayBuffer();
      return new Response(bodyBuffer3, {
        status: response3.status,
        headers: responseHeaders3
      });
    } catch (err) {
      console.error('Error forwarding Gemini default path:', err);
      return new Response(
        JSON.stringify({ error: 'Internal Server Error', details: err?.stack }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  }
}
