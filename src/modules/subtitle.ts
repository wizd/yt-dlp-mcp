import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Config } from '../config.js';
import { _spawnPromise, validateUrl, isYouTubeUrl } from "./utils.js";

/**
 * Lists all available subtitles for a video.
 *
 * @param url - The URL of the video
 * @returns Promise resolving to a string containing the list of available subtitles
 * @throws {Error} When URL is invalid or subtitle listing fails
 *
 * @example
 * ```typescript
 * try {
 *   const subtitles = await listSubtitles('https://youtube.com/watch?v=...');
 *   console.log('Available subtitles:', subtitles);
 * } catch (error) {
 *   console.error('Failed to list subtitles:', error);
 * }
 * ```
 */
export async function listSubtitles(url: string): Promise<string> {
  if (!validateUrl(url)) {
    throw new Error("Invalid or unsupported URL format");
  }

  try {
    const args = [
      "--list-subs",
      "--write-auto-sub",
      "--skip-download",
      "--verbose",
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

    const output = await _spawnPromise("yt-dlp", args);
    return output;
  } catch (error) {
    throw error;
  }
}

/**
 * Downloads subtitles for a video in the specified language.
 * 
 * @param url - The URL of the video
 * @param language - Language code (e.g., 'en', 'zh-Hant', 'ja')
 * @param config - Configuration object
 * @returns Promise resolving to the subtitle content
 * @throws {Error} When URL is invalid, language is not available, or download fails
 * 
 * @example
 * ```typescript
 * try {
 *   // Download English subtitles
 *   const enSubs = await downloadSubtitles('https://youtube.com/watch?v=...', 'en', config);
 *   console.log('English subtitles:', enSubs);
 * 
 *   // Download Traditional Chinese subtitles
 *   const zhSubs = await downloadSubtitles('https://youtube.com/watch?v=...', 'zh-Hant', config);
 *   console.log('Chinese subtitles:', zhSubs);
 * } catch (error) {
 *   if (error.message.includes('No subtitle files found')) {
 *     console.warn('No subtitles available in the requested language');
 *   } else {
 *     console.error('Failed to download subtitles:', error);
 *   }
 * }
 * ```
 */
export async function downloadSubtitles(
  url: string,
  language: string,
  config: Config
): Promise<string> {
  if (!validateUrl(url)) {
    throw new Error('Invalid or unsupported URL format');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), config.file.tempDirPrefix));

  try {
    const args = [
      "--write-sub",
      "--write-auto-sub",
      "--sub-lang",
      language,
      "--skip-download",
      "--output",
      path.join(tempDir, "%(title)s.%(ext)s"),
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

    const subtitleFiles = fs.readdirSync(tempDir)
      .filter(file => file.endsWith('.vtt'));

    if (subtitleFiles.length === 0) {
      throw new Error('No subtitle files found');
    }

    let output = '';
    for (const file of subtitleFiles) {
      output += fs.readFileSync(path.join(tempDir, file), 'utf8');
    }

    return output;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
} 