const { transcribeLocalMedia } = require("../scripts/transcribe_local_media");

async function transcribeLocalMediaApi(input, options = {}) {
  const result = await transcribeLocalMedia(input, options);
  return {
    ok: result.status === "completed",
    status: result.status,
    source: {
      platform: "local_media",
      input_path: result.input_path,
    },
    model: {
      size: result.model_size,
      path: result.model_path,
      language: result.language,
      threads: result.threads,
    },
    performance: {
      media_duration_seconds: result.media_duration_seconds,
      effective_audio_seconds: result.effective_audio_seconds,
      timings_ms: result.timings_ms,
      transcribe_speed_multiplier: result.transcribe_speed_multiplier,
    },
    outputs: result.outputs,
  };
}

module.exports = {
  transcribeLocalMedia: transcribeLocalMediaApi,
};
