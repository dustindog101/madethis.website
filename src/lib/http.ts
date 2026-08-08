export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function error(status = 400, code = "bad_request", message?: string): Response {
  return json({ ok: false, error: { code, message: message ?? code } }, status);
}