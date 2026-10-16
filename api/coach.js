// Vercel serverless function: POST /api/coach
import { coach } from "../lib/coach.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Use POST." }); }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const { status, data } = await coach(body || {});
  res.status(status).json(data);
}
