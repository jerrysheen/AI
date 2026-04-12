#!/usr/bin/env node

const assert = require("node:assert/strict");
const {
  shouldFinalizeAsEmptyResult,
  buildYoutubeContentFiles,
  buildYoutubeIndexFiles,
  buildYoutubeJobNotes,
} = require("./scripts/fetch_youtube");

function run() {
  assert.equal(
    shouldFinalizeAsEmptyResult({
      metadata: { title: "Example" },
      subtitleResult: null,
      options: {},
    }),
    true
  );

  assert.equal(
    shouldFinalizeAsEmptyResult({
      metadata: { title: "Example" },
      subtitleResult: { full_text: "hello" },
      options: {},
    }),
    false
  );

  assert.equal(
    shouldFinalizeAsEmptyResult({
      metadata: { title: "Example" },
      subtitleResult: null,
      options: { cookiesFromBrowser: "chrome" },
    }),
    false
  );

  const files = buildYoutubeContentFiles({
    content_exists: true,
    transcript_path: null,
    video_exists: false,
  });
  assert.deepEqual(files, {
    text: "content.txt",
    transcript: null,
    images: null,
    video: null,
  });

  const indexFiles = buildYoutubeIndexFiles({
    metadata_exists: true,
    content_exists: true,
    transcript_path: null,
    video_exists: false,
  });
  assert.deepEqual(indexFiles, {
    metadata: "metadata.json",
    content: "content.txt",
    transcript: null,
    translated: null,
    summary: null,
    images_dir: null,
    video_file: null,
  });

  const note = buildYoutubeJobNotes({
    subtitleSkipped: true,
    subtitleResult: null,
  });
  assert.match(note, /空结果收口/);

  console.log("pull-youtubeInfo tests passed");
}

run();
