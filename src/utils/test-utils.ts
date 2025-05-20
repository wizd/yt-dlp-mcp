import type { Config } from '../config.js';

export const mockConfig: Config = {
  file: {
    maxFilenameLength: 100,
    downloadsDir: "/mock/downloads",
    tempDirPrefix: "ytdlp-test-",
    sanitize: {
      replaceChar: "_",
      truncateSuffix: "...",
      illegalChars: /[<>:"/\\|?*\x00-\x1F]/g,
      reservedNames: ["CON", "PRN", "AUX", "NUL"],
    },
    hostingUrlBase: "http://localhost",
  },
  tools: {
    required: ["yt-dlp"],
  },
  download: {
    defaultResolution: "720p",
    defaultAudioFormat: "m4a",
    defaultSubtitleLanguage: "en",
  },
}; 