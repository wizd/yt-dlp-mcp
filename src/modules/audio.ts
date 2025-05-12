import { readdirSync } from "fs";
import * as path from "path";
import type { Config } from "../config.js";
import { sanitizeFilename } from "../config.js";
import {
  _spawnPromise,
  validateUrl,
  isYouTubeUrl,
  generateRandomFilename,
} from "./utils.js";

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
export async function downloadAudio(
  url: string,
  config: Config
): Promise<string> {
  try {
    validateUrl(url);

    const randomFileBaseName = generateRandomFilename().replace(/\.\w+$/, "");
    const sanitizedFileBase = sanitizeFilename(randomFileBaseName, config.file);

    const outputTemplate = path.join(
      config.file.downloadsDir,
      sanitizedFileBase + ".%(ext)s"
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
    const downloadedFile = files.find((file) =>
      file.startsWith(sanitizedFileBase)
    );
    if (!downloadedFile) {
      throw new Error(
        `Download completed but file starting with "${sanitizedFileBase}" not found`
      );
    }
    const downloadedFilePath = path.join(
      config.file.downloadsDir,
      downloadedFile
    );

    console.log(
      `Audio downloaded, path: ${config.file.hostingUrlBase}/${path.basename(
        downloadedFilePath
      )}`
    );

    return `Audio successfully downloaded as ${downloadedFile} to ${
      config.file.downloadsDir
    }.
    You can access it via url: ${config.file.hostingUrlBase}/${path.basename(
      downloadedFilePath
    )}`;
  } catch (error) {
    throw error;
  }
} 