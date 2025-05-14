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

  let outputTemplate: string;
  let expectedFilename: string;

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

    // Always use a random filename
    // 生成一个不带硬编码扩展名的随机文件名基础部分
    const randomFileBase = generateRandomFilename().replace(/\\.\\w+$/, ""); // 移除末尾的 .mp4 或其他可能的扩展名

    // 清理随机文件名基础部分
    const sanitizedFileBase = sanitizeFilename(
      randomFileBase,
      effectiveConfig.file
    );

    // outputTemplate 应包含 .%(ext)s 让 yt-dlp 自动处理扩展名
    outputTemplate = path.join(
      userDownloadsDir,
      sanitizedFileBase + ".%(ext)s"
    );

    // expectedFilename 暂时用 .mp4 后缀。如果后续的目录查找成功，它会被覆盖。
    expectedFilename = path.join(userDownloadsDir, sanitizedFileBase + ".mp4");

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
      await _spawnPromise("yt-dlp", args); // 实际下载

      // 尝试修正 expectedFilename 的扩展名
      // 此逻辑之前依赖 filenameResolvedByYtdlp, 现在总是执行
      try {
        const filesInDir = fs.readdirSync(userDownloadsDir);
        // sanitizedFileBase 是不带路径和扩展名的纯文件名基础
        const actualDownloadedFile = filesInDir.find((f) =>
          f.startsWith(sanitizedFileBase)
        );

        if (actualDownloadedFile) {
          // 如果找到了匹配的文件，更新 expectedFilename 为包含实际扩展名的完整路径
          expectedFilename = path.join(userDownloadsDir, actualDownloadedFile);
        } else {
          // 未找到匹配文件，这不应该发生如果下载成功。日志警告，expectedFilename 保持原样（带.mp4后缀）
          console.warn(
            `[WARN] Post-download: Could not find file starting with "${sanitizedFileBase}" in "${userDownloadsDir}". ` +
              `The success message might use a default .mp4 extension for ${sanitizedFileBase}.`
          );
        }
      } catch (readdirError) {
        // 读取目录失败，日志警告，expectedFilename 保持原样
        console.warn(
          `[WARN] Post-download: Error reading directory "${userDownloadsDir}" to find actual filename for base "${sanitizedFileBase}". Error: ${readdirError}`
        );
      }
    } catch (error) {
      throw new Error(
        `Download failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    console.log(
      `all done, expectedFilename: ${
        effectiveConfig.file.hostingUrlBase
      }/${path.basename(expectedFilename)}`
    );

    // 使用 effectiveConfig 来获取 hostingUrlBase
    return `Video successfully downloaded to working dir as: ${path.basename(
      expectedFilename
    )}
    You can access it via url: ${
      effectiveConfig.file.hostingUrlBase
    }/${path.basename(expectedFilename)}`;
  } catch (error) {
    throw error;
  }
} 