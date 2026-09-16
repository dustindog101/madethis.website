import assert from "node:assert/strict";
import { test } from "node:test";
import { fflateEntryLevel, jszipFileOptions, zipCompressionFor } from "./zip-compression.js";

test("text assets use DEFLATE", () => {
  for (const name of ["index.html", "app.js", "main.mjs", "styles.css", "data.json", "icon.svg", "notes.md", "readme.txt"]) {
    assert.equal(zipCompressionFor(name).method, "DEFLATE");
  }
});

test("precompressed binaries use STORE", () => {
  for (const name of ["photo.png", "hero.jpg", "hero.jpeg", "shot.webp", "loop.gif", "pic.avif", "font.woff2", "bundle.zip", "video.mp4", "clip.webm", "movie.mov", "track.mp3"]) {
    assert.equal(zipCompressionFor(name).method, "STORE");
  }
});

test("jszip options match the method", () => {
  assert.deepEqual(jszipFileOptions("index.html", 6), {
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  assert.deepEqual(jszipFileOptions("photo.png", 6), {
    compression: "STORE",
  });
});

test("fflate uses level 0 for STORE and the given level for DEFLATE", () => {
  assert.equal(fflateEntryLevel("photo.png", 9), 0);
  assert.equal(fflateEntryLevel("index.html", 9), 9);
  assert.equal(fflateEntryLevel("app.css", 6), 6);
});
