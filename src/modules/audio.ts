import { readdirSync } from "fs";
import * as path from "path";
import type { Config } from "../config.js";
import { sanitizeFilename } from "../config.js";
import { _spawnPromise, validateUrl, getFormattedTimestamp, isYouTubeUrl } from "./utils.js";

/**
 * Downloads audio from a video URL in the best available quality.
 * 
 * @param url - The URL of the video to extract audio from
 * @param config - Configuration object for download settings
 * @returns Promise resolving to a success message with the downloaded file path
 * @throws {Error} When URL is invalid or download fails
 * 
 * @example
 * ```typescript
 * // Download audio with default settings
 * const result = await downloadAudio('https://youtube.com/watch?v=...');
 * console.log(result);
 * 
 * // Download audio with custom config
 * const customResult = await downloadAudio('https://youtube.com/watch?v=...', {
 *   file: {
 *     downloadsDir: '/custom/path',
 *     // ... other config options
 *   }
 * });
 * console.log(customResult);
 * ```
 */
export async function downloadAudio(url: string, config: Config): Promise<string> {
  const timestamp = getFormattedTimestamp();
  
  try {
    validateUrl(url);
    
    const outputTemplate = path.join(
      config.file.downloadsDir,
      sanitizeFilename(`%(title)s [%(id)s] ${timestamp}`, config.file) + '.%(ext)s'
    );

    const format = isYouTubeUrl(url) 
      ? "140/bestaudio[ext=m4a]/bestaudio"
      : "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio";

    const args = [
      "--verbose",
      "--progress",
      "--newline",
      "--no-mtime",
      "-f",
      format,
      "--output",
      outputTemplate,
    ];

    // 如果是YouTube视频，添加cookies以通过bot验证
    if (isYouTubeUrl(url)) {
      const cookiePath = path.resolve(
        new URL(import.meta.url).pathname,
        "../yt-cookies.txt"
      );
      args.push("--cookies", cookiePath);
    }

    args.push(url);

    await _spawnPromise("yt-dlp", args);

    const files = readdirSync(config.file.downloadsDir);
    const downloadedFile = files.find(file => file.includes(timestamp));
    if (!downloadedFile) {
      throw new Error("Download completed but file not found");
    }
    return `Audio successfully downloaded as "${downloadedFile}" to ${config.file.downloadsDir}`;
  } catch (error) {
    throw error;
  }
} 