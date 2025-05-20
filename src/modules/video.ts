import * as path from "path";
import type { Config } from "../config.js";
import * as fs from "fs";
// 导入全局配置，并重命名以避免与参数名混淆
import { CONFIG as GlobalAppConfig, sanitizeFilename } from "../config.js";
import {
  _spawnPromise,
  validateUrl,
  isYouTubeUrl,
  generateRandomFilename,
} from "./utils.js";
import { getCookieFilePath } from "./cookieManager.js"; // Import the new cookie manager

/**
 * 定义下载结果的接口
 */
export interface DownloadResult {
  success: boolean;
  message: string;
  videoFilename?: string;
  metaFilename?: string;
  downloadUrl?: string;
  originalUrl?: string;
}

/**
 * Downloads a video from the specified URL.
 *
 * @param url - The URL of the video to download
 * @param configParam - Optional configuration object for download settings. If not provided, global config is used.
 * @param resolution - Preferred video resolution ('480p', '720p', '1080p', 'best')
 * @returns Promise resolving to a DownloadResult object
 * @throws {Error} Rethrows errors from underlying operations, but the function itself aims to return a DownloadResult.
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
 * import { loadConfig } from "./config"; // Assuming loadConfig is in a config file at the same level
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

  let outputTemplate: string;
  let baseVideoFilename: string; // This will hold just the filename.ext part

  try {
    validateUrl(url);

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

    const randomFileBase = generateRandomFilename().replace(/\\.\\w+$/, "");
    const rawSanitizedFileBase = sanitizeFilename(
      randomFileBase,
      effectiveConfig.file
    );
    const sanitizedFileBase = rawSanitizedFileBase.replace(/\.mp4$/i, "");

    outputTemplate = path.join(
      userDownloadsDir,
      sanitizedFileBase + ".%(ext)s"
    );

    const args = [
      "--write-info-json",
      "--progress",
      "--newline",
      "--no-mtime",
      "-f",
      format,
      "--output",
      outputTemplate,
    ];

    const cookiePath = getCookieFilePath(url);
    if (cookiePath) {
      args.push("--cookies", cookiePath);
    }

    args.push(url);

    console.log("yt-dlp args:", args);
    await _spawnPromise("yt-dlp", args);

    // Discover the actual downloaded filename (with correct extension)
    try {
      const filesInDir = fs.readdirSync(userDownloadsDir);
      const actualDownloadedFile = filesInDir.find(
        (f) => f.startsWith(sanitizedFileBase) && !f.endsWith(".json") // Exclude .info.json
      );

      if (actualDownloadedFile) {
        baseVideoFilename = actualDownloadedFile; // Store just the filename.ext
      } else {
        console.warn(
          `[WARN] Post-download: Could not find video file starting with "${sanitizedFileBase}" in "${userDownloadsDir}". Using fallback with .mp4.`
        );
        // If not found, baseVideoFilename will use the sanitized base + .mp4
        baseVideoFilename = sanitizedFileBase + ".mp4";
        // expectedFilename remains as initially set (userDownloadsDir + sanitizedFileBase + ".mp4")
      }
    } catch (readdirError) {
      console.warn(
        `[WARN] Post-download: Error reading directory "${userDownloadsDir}" to find actual filename for base "${sanitizedFileBase}". Error: ${readdirError}`
      );
      // Fallback if readdir fails
      baseVideoFilename = sanitizedFileBase + ".mp4";
      // expectedFilename remains as initially set
    }

    const metaFilename =
      baseVideoFilename.substring(0, baseVideoFilename.lastIndexOf(".")) +
      ".info.json";
    const downloadUrl = `${effectiveConfig.file.hostingUrlBase}/${baseVideoFilename}`;

    console.log(
      `Download successful. Video: ${baseVideoFilename}, Meta: ${metaFilename}, URL: ${downloadUrl}`
    );

    return JSON.stringify({
      success: true,
      message: `Video successfully downloaded as ${baseVideoFilename}.`,
      videoFilename: baseVideoFilename,
      metaFilename: metaFilename,
      downloadUrl: downloadUrl,
      originalUrl: url,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Download failed: ${errorMessage}`);
    // Check if it's a specific download error or a URL validation error etc.
    if (
      error instanceof Error &&
      error.message.startsWith("Download failed:")
    ) {
      return JSON.stringify({
        success: false,
        message: errorMessage, // Already includes "Download failed: " prefix
        originalUrl: url,
      });
    }
    // For other errors (e.g., URL validation, setup issues)
    return JSON.stringify({
      success: false,
      message: `Operation failed: ${errorMessage}`,
      originalUrl: url,
    });
  }
} 