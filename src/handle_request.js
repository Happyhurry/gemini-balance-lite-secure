// src/handle_request.js

import { handleVerification } from './verify_keys.js';
import openai from './openai.mjs';

export const config = {
  runtime: 'edge',  // 保持 Edge Runtime（因为你之前是这个 runtime）
};

export async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const search = url.search;

  console.log('Incoming request URL:', request.url);
  console.log('Incoming headers:', JSON.stringify(Object.fromEntries(request.headers.entries())));

  // 根或首页
  if (pathname === '/' || pathname === '/index.html') {
    return new Response(
      'Proxy is Running! More Details: https://github.com/tech-shrimp/gemini-balance-lite',
      {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      }
    );
  }

  // /verify POST 公开端点
  if (pathname === '/verify' && request.method === 'POST') {
    return handleVerification(request);
  }

  // —— 身份验证 —— 支持 X-API-Key 或 Authorization: Bearer … 或 x-goog-api-key
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

  // —— 特殊 Gemini 流式 / generateContent 路径处理 —— 包含 :streamGenerateContent 或 :generateContent
  if (
    pathname.includes(':') &&
    (pathname.toLowerCase().includes('streamgeneratecontent') || pathname.toLowerCase().includes('generatecontent'))
  ) {
    console.log('Routing to Gemini native (special path for streaming/generateContent) for path:', pathname);
    // 修正路径
    const parts = pathname.split(':');
    let modelPart = parts[0].startsWith('/') ? parts[0].substring(1) : parts[0];
    const actionPart = parts.slice(1).join(':');  // 支持如果 action 中也有冒号或额外部分
    const fixedPath = `/v1beta/models/${modelPart}:${actionPart}`;

    const newTargetUrl = `https://generativelanguage.googleapis.com${fixedPath}${search}`;
    console.log('FixedTargetUrl:', newTargetUrl);

    // 准备 Gemini API Key
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

    // 构建下游请求 headers
    const downstreamHeaders = new Headers();
    for (const [key, value] of request.headers.entries()) {
      const lower = key.trim().toLowerCase();
      if (lower === 'x-goog-api-key') continue;
      if (lower === 'content-type' || lower === 'accept') {
        downstreamHeaders.set(key, value);
      }
    }
    downstreamHeaders.set('x-goog-api-key', selectedKey);
    // 如果需要 SSE / streaming，用 Accept: text/event-stream 或者依据 upstream 要求
    downstreamHeaders.set('Accept', 'text/event-stream');

    // 发起下游请求
    const upstreamResponse = await fetch(newTargetUrl, {
      method: request.method,
      headers: downstreamHeaders,
      body: request.body
    });

    console.log('Gemini downstream status (special path):', upstreamResponse.status);

    if (!upstreamResponse.ok) {
      const errText = await upstreamResponse.text();
      return new Response(errText, {
        status: upstreamResponse.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 流式转发响应
    const responseHeaders2 = new Headers(upstreamResponse.headers);
    // 保证正确内容类型
    responseHeaders2.set('Content-Type', 'text/event-stream');
    responseHeaders2.set('Referrer-Policy', 'no-referrer');

    const bodyStream = upstreamResponse.body;

    return new Response(bodyStream, {
      status: 200,
      headers: responseHeaders2
    });
  }

  // —— 默认 Gemini 原生路径 —— 非 OpenAI，也非特殊 generateContent 路径
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

    const downstreamHeaders2 = new Headers();
    for (const [key, value] of request.headers.entries()) {
      const lower = key.trim().toLowerCase();
      if (lower === 'x-goog-api-key') continue;
      if (lower === 'content-type' || lower === 'accept') {
        downstreamHeaders2.set(key, value);
      }
    }
    downstreamHeaders2.set('x-goog-api-key', selectedKey);

    try {
      const response3 = await fetch(targetUrl, {
        method: request.method,
        headers: downstreamHeaders2,
        body: request.body
      });
      console.log('Gemini downstream status (default):', response3.status);

      const responseHeaders3 = new Headers(response3.headers);
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
