import assert from "node:assert/strict";
import { test } from "node:test";
import { isVideoPath, contentTypeFor } from "./mime.js";
import { maybeVideoViewerResponse } from "./serve.js";
import { videoViewerHtml } from "./video-viewer.js";
import type { SiteMeta } from "./site.js";

test("isVideoPath detects video extensions", () => {
  assert.equal(isVideoPath("movie.mp4"), true);
  assert.equal(isVideoPath("clip.webm"), true);
  assert.equal(isVideoPath("recording.mov"), true);
  assert.equal(isVideoPath("video.m4v"), true);
  assert.equal(isVideoPath("animation.ogv"), true);
  assert.equal(isVideoPath("photo.png"), false);
  assert.equal(isVideoPath("index.html"), false);
  assert.equal(isVideoPath("noext"), false);
});

test("contentTypeFor returns correct video MIME types", () => {
  assert.equal(contentTypeFor("test.mp4"), "video/mp4");
  assert.equal(contentTypeFor("test.webm"), "video/webm");
  assert.equal(contentTypeFor("test.mov"), "video/quicktime");
  assert.equal(contentTypeFor("test.m4v"), "video/mp4");
});

test("videoViewerHtml produces HTML with video controls and countdown", () => {
  const html = videoViewerHtml({
    slug: "test1234",
    pathname: "clip.mp4",
    rawUrl: "/s/test1234/clip.mp4?raw=1",
    fullRawUrl: "https://madethis.website/s/test1234/clip.mp4?raw=1",
    filename: "clip.mp4",
    expiresAt: Date.now() + 86400000,
    createdAt: Date.now(),
    bytes: 1048576,
    contentType: "video/mp4",
  });

  assert.ok(html.includes("<video"), "should contain video tag");
  assert.ok(html.includes('controls'), "video tag should have controls");
  assert.ok(html.includes('playsinline'), "video tag should have playsinline");
  assert.ok(html.includes('clip.mp4'), "should include filename");
  assert.ok(html.includes('/s/test1234/clip.mp4?raw=1'), "should include raw video source");
  assert.ok(html.includes('video/mp4'), "should specify video content type");
});

test("maybeVideoViewerResponse renders viewer for document request and skips for raw", () => {
  const meta: SiteMeta = {
    slug: "testslug",
    createdAt: Date.now(),
    expiresAt: Date.now() + 86400000,
    ttlSeconds: 86400,
    graceActive: true,
    bytes: 1024,
    files: 1,
    homepage: "demo.mp4",
  };

  const docRequest = new Request("https://madethis.website/s/testslug/demo.mp4", {
    headers: { accept: "text/html,application/xhtml+xml", "sec-fetch-dest": "document" },
  });

  const res = maybeVideoViewerResponse("testslug", "demo.mp4", meta, 1024, false, docRequest);
  assert.ok(res !== null);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type")?.includes("text/html"));

  // Raw request skips viewer
  const rawRes = maybeVideoViewerResponse("testslug", "demo.mp4", meta, 1024, true, docRequest);
  assert.equal(rawRes, null);

  // Subresource video fetch skips viewer
  const subresourceReq = new Request("https://madethis.website/s/testslug/demo.mp4", {
    headers: { accept: "*/*", "sec-fetch-dest": "video" },
  });
  const subRes = maybeVideoViewerResponse("testslug", "demo.mp4", meta, 1024, false, subresourceReq);
  assert.equal(subRes, null);
});
