export function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

export function error(status = 400, code = "bad_request", message?: string, extraHeaders?: Record<string, string>): Response {
  return json({ ok: false, error: { code, message: message ?? code } }, status, extraHeaders);
}

export function rateLimited(resetAt: number, message?: string): Response {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return error(429, "rate_limited", message ?? "Too many requests. Slow down and try again.", {
    "Retry-After": String(retryAfter),
    "X-RateLimit-Remaining": "0",
    "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
  });
}