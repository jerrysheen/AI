const { fetchTikTokVideo } = require("../scripts/fetch_tiktok_video");
const { fetchTikTokAudio, extractWAV, checkFFmpeg } = require("../scripts/fetch_tiktok_audio");

module.exports = {
  fetchTikTokVideo,
  fetchTikTokAudio,
  extractWAV,
  checkFFmpeg,
};
