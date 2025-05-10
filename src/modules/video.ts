import * as path from "path";
import type { Config } from "../config.js";
import * as fs from "fs";
// 导入全局配置，并重命名以避免与参数名混淆
import { CONFIG as GlobalAppConfig, sanitizeFilename } from "../config.js";
import {
  _spawnPromise,
  validateUrl,
  getFormattedTimestamp,
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
  let filenameResolvedByYtdlp = true; // 标志位，true表示通过--get-filename成功获取
  let fileBaseForRandomFallback = ""; // 用于存储随机文件名回退时的基础文件名

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
      // filenameResolvedByYtdlp 保持 true
    } catch (error) {
      filenameResolvedByYtdlp = false; // --get-filename 失败
      // 如果無法獲取檔案名稱，使用隨機檔案名
      // 生成一个不带硬编码扩展名的随机文件名基础部分
      const randomFileBaseName = generateRandomFilename() // 调用时不传参数，使用默认的 'mp4'
        .replace(/\.\w+$/, ""); // 移除末尾的 .mp4 或其他可能的扩展名

      // 清理并保存随机文件名基础部分，用于后续查找
      fileBaseForRandomFallback = sanitizeFilename(
        randomFileBaseName,
        effectiveConfig.file
      );

      // outputTemplate 应包含 .%(ext)s 让 yt-dlp 自动处理扩展名
      outputTemplate = path.join(
        userDownloadsDir,
        fileBaseForRandomFallback + ".%(ext)s"
      );

      // expectedFilename 暂时用 .mp4 后缀。如果后续的目录查找成功，它会被覆盖。
      // 如果查找失败，日志和返回消息中的扩展名可能不准，但文件本身扩展名是正确的。
      expectedFilename = path.join(
        userDownloadsDir,
        fileBaseForRandomFallback + ".mp4"
      );
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
      await _spawnPromise("yt-dlp", args); // 实际下载

      // 如果是通过随机文件名回退路径下载的，尝试修正 expectedFilename 的扩展名
      if (!filenameResolvedByYtdlp) {
        try {
          const filesInDir = fs.readdirSync(userDownloadsDir);
          // fileBaseForRandomFallback 是不带路径和扩展名的纯文件名基础
          const actualDownloadedFile = filesInDir.find((f) =>
            f.startsWith(fileBaseForRandomFallback)
          );

          if (actualDownloadedFile) {
            // 如果找到了匹配的文件，更新 expectedFilename 为包含实际扩展名的完整路径
            expectedFilename = path.join(
              userDownloadsDir,
              actualDownloadedFile
            );
          } else {
            // 未找到匹配文件，这不应该发生如果下载成功。日志警告，expectedFilename 保持原样（带.mp4后缀）
            console.warn(
              `[WARN] Post-download: Could not find file starting with "${fileBaseForRandomFallback}" in "${userDownloadsDir}". ` +
                `The success message might use a default .mp4 extension for ${fileBaseForRandomFallback}.`
            );
          }
        } catch (readdirError) {
          // 读取目录失败，日志警告，expectedFilename 保持原样
          console.warn(
            `[WARN] Post-download: Error reading directory "${userDownloadsDir}" to find actual filename for base "${fileBaseForRandomFallback}". Error: ${readdirError}`
          );
        }
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
    return `Video successfully downloaded as ${
      effectiveConfig.file.hostingUrlBase
    }/${path.basename(expectedFilename)}`;
  } catch (error) {
    throw error;
  }
} 