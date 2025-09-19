import { handleRequest } from "../src/handle_request.js";

export const config = {
  runtime: 'edge' // 告诉 Vercel 这是 Edge Function
};

export default async function handler(req) {
  const url = new URL(req.url);
  console.log('Request URL:', req.url);

  // 直接调用 handleRequest，不再在这里验证
  return handleRequest(req);
}
