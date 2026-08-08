import type { APIRoute } from "astro";

export const prerender = false;

/** `/s/{slug}` without trailing slash breaks relative assets — canonicalize early. */
export const GET: APIRoute = async ({ params, request }) => {
  const slug = params.token ?? "";
  const url = new URL(request.url);
  const target = `/s/${slug}/${url.search}`;
  return Response.redirect(target, 308);
};

export const HEAD: APIRoute = GET;
