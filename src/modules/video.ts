import * as path from "path";
import type { Config } from "../config.js";
// 导入全局配置，并重命名以避免与参数名混淆
import { CONFIG as GlobalAppConfig, sanitizeFilename } from "../config.js";
import { 
  _spawnPromise, 
  validateUrl, 
  getFormattedTimestamp, 
  isYouTubeUrl,
  generateRandomFilename 
} from "./utils.js";

/**
 * Downloads a video from the specified URL.
 * 
 * @param url - The URL of the video to download
 * @param configParam - Optional configuration object for download settings. If not provided, global config is used.
 * @param resolution - Preferred video resolution ('480p', '720p', '1080p', 'best')
 * @returns Promise resolving to a success message with the downloaded file path
 * @throws {Error} When URL is invalid or download fails
 * 
 * @example
 * ```typescript
 * // Download with default settings (uses global config)
 * const result = await downloadVideo('https://youtube.com/watch?v=...');
 * console.log(result);
 * 
 * // Download with specific resolution (uses global config)
 * const hdResult = await downloadVideo(
 *   'https://youtube.com/watch?v=...',
 *   undefined, // Explicitly pass undefined to use global config for settings
 *   '1080p'
 * );
 * console.log(hdResult);
 * 
 * // Download with a custom config object
 * import { loadConfig } from "./config";
 * const customConfig = loadConfig(); // or your custom config object
 * const customResult = await downloadVideo(
 *  'https://youtube.com/watch?v=...',
 *  customConfig,
 *  'best'
 * );
 * console.log(customResult);
 * ```
 */
export async function downloadVideo(
  url: string,
  configParam?: Config, // config 参数变为可选
  resolution: "480p" | "720p" | "1080p" | "best" = "720p"
): Promise<string> {
  console.log("downloadVideo", url, configParam, resolution);
  // 如果没有传入 configParam，则使用全局配置 GlobalAppConfig
  const effectiveConfig = configParam || GlobalAppConfig;

  // 使用 effectiveConfig 替代旧的 config 参数
  const userDownloadsDir = effectiveConfig.file.downloadsDir;

  try {
    validateUrl(url);
    const timestamp = getFormattedTimestamp();

    let format: string;
    if (isYouTubeUrl(url)) {
      // YouTube-specific format selection
      switch (resolution) {
        case "480p":
          format = "bestvideo[height<=480]+bestaudio/best[height<=480]/best";
          break;
        case "720p":
          format = "bestvideo[height<=720]+bestaudio/best[height<=720]/best";
          break;
        case "1080p":
          format = "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best";
          break;
        case "best":
          format = "bestvideo+bestaudio/best";
          break;
        default:
          format = "bestvideo[height<=720]+bestaudio/best[height<=720]/best";
      }
    } else {
      // For other platforms, use quality labels that are more generic
      switch (resolution) {
        case "480p":
          format = "worst[height>=480]/best[height<=480]/worst";
          break;
        case "best":
          format = "bestvideo+bestaudio/best";
          break;
        default: // Including 720p and 1080p cases
          // Prefer HD quality but fallback to best available
          format = "bestvideo[height>=720]+bestaudio/best[height>=720]/best";
      }
    }

    let outputTemplate: string;
    let expectedFilename: string;

    try {
      // 嘗試獲取檔案名稱
      outputTemplate = path.join(
        userDownloadsDir,
        sanitizeFilename(
          `%(title)s [%(id)s] ${timestamp}`,
          effectiveConfig.file
        ) + ".%(ext)s"
      );

      expectedFilename = await _spawnPromise("yt-dlp", [
        "--get-filename",
        "-f",
        format,
        "--output",
        outputTemplate,
        url,
      ]);
      expectedFilename = expectedFilename.trim();
    } catch (error) {
      // 如果無法獲取檔案名稱，使用隨機檔案名
      const randomFilename = generateRandomFilename("mp4");
      outputTemplate = path.join(userDownloadsDir, randomFilename);
      expectedFilename = randomFilename;
    }

    // Download with progress info
    try {
      const args = [
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

      console.log("yt-dlp args:", args);
      await _spawnPromise("yt-dlp", args);
    } catch (error) {
      throw new Error(
        `Download failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    console.log(
      `all done, expectedFilename: ${effectiveConfig.file.hostingUrlBase}/${expectedFilename}`
    );

    // 使用 effectiveConfig 来获取 hostingUrlBase
    return `Video successfully downloaded as "${
      effectiveConfig.file.hostingUrlBase
    }/${path.basename(expectedFilename)}"`;
  } catch (error) {
    throw error;
  }
} 