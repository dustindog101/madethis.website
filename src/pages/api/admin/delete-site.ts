import type { APIRoute } from "astro";
import { json, error } from "../../../lib/http.js";
import { isAdminSession } from "../../../lib/session.js";
import { deleteSite } from "../../../lib/site.js";
import { validSlug } from "../../../lib/ids.js";

export const prerender = false;

interface DeleteBody {
  slug?: string;
}

export const POST: APIRoute = async ({ request }) => {
  if (!(await isAdminSession(request))) {
    return error(401, "unauthorized", "Admin session required.");
  }

  let body: DeleteBody;
  try {
    body = (await request.json()) as DeleteBody;
  } catch {
    return error(400, "invalid_json");
  }

  if (!body.slug || !validSlug(body.slug)) {
    return error(400, "invalid_slug", "A valid site slug is required.");
  }

  try {
    await deleteSite(body.slug);
    return json({ ok: true, slug: body.slug });
  } catch {
    return error(500, "delete_failed", "Failed to delete site.");
  }
};
