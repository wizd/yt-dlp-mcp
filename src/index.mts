#!/usr/bin/env node

import express from "express";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { CONFIG } from "./config.js";
import { _spawnPromise, safeCleanup } from "./modules/utils.js";
import { downloadVideo } from "./modules/video.js";
import { downloadAudio } from "./modules/audio.js";
import { RestServerTransport } from "@wizdy/typescript-sdk/server/rest.js";
import { getParamValue } from "@wizdy/typescript-sdk/utils/index.js";
import { Request, Response } from "express";
import { HostVideoToR2 } from "./modules/R2/VideoPipeline.js";
import { BlaxelMcpServerTransport } from "@wizdy/blaxel_core";
import { speechToText } from "./modules/speech/stt.mjs";
import { generateSrtSubtitles } from "./modules/speech/stt.mjs";
import { embedSubtitles } from "./modules/subtitles.mjs";
import { textToSpeech } from "./modules/speech/tts.mjs";
import { readFileContent, writeFileContent } from "./modules/file_io.mjs";
import { executeFFprobeCommand } from "./modules/ffprobe_tool.js";
import { createServer } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "crypto";
import { listSubtitles } from "./modules/subtitle.js";
import { downloadSubtitles } from "./modules/subtitle.js";

const VERSION = "0.6.27";

/**
 * Validates that the provided filename is a simple filename string without path components or traversal attempts.
 * Throws an error if validation fails.
 * @param filename The filename to validate.
 * @param friendlyName The user-facing name of the parameter (e.g., "input filename").
 * @returns The validated filename.
 */
function validateIsSafeBasename(
  filename: string | undefined,
  friendlyName: string = "filename"
): string {
  if (typeof filename !== "string" || filename.trim() === "") {
    throw new Error(`${friendlyName} must be a non-empty string.`);
  }
  // Normalize to catch subtle ".." variations if any slip past basic checks
  const normalizedFilename = path.normalize(filename);

  if (
    normalizedFilename.includes("..") ||
    path.isAbsolute(normalizedFilename)
  ) {
    throw new Error(
      `Invalid ${friendlyName} '${filename}': '..' and absolute paths are not allowed.`
    );
  }
  const basename = path.basename(normalizedFilename);
  if (basename !== normalizedFilename) {
    throw new Error(
      `Invalid ${friendlyName} '${filename}': Path components (e.g., '/') are not allowed. Provide a direct filename only.`
    );
  }
  return normalizedFilename;
}

/**
 * Validates that the provided relativePath is safe for use within a base directory.
 * It checks for '..' and absolute paths. Subdirectories can be allowed or disallowed.
 * Throws an error if validation fails.
 * Note: The consuming function is still responsible for resolving against the actual base directory
 * and ensuring the final path is within that base.
 * @param relativePath The relative path to validate.
 * @param allowSubdirectories Whether to allow slashes for subdirectories.
 * @param friendlyName The user-facing name of the parameter (e.g., "target path").
 * @returns The validated relative path.
 */
function validateIsSafeRelativePath(
  relativePath: string | undefined,
  allowSubdirectories: boolean,
  friendlyName: string = "path"
): string {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new Error(`${friendlyName} must be a non-empty string.`);
  }
  const normalizedPath = path.normalize(relativePath);

  if (normalizedPath.includes("..") || path.isAbsolute(normalizedPath)) {
    throw new Error(
      `Invalid ${friendlyName} '${relativePath}': '..' and absolute paths are not allowed.`
    );
  }
  if (
    !allowSubdirectories &&
    (normalizedPath.includes(path.sep) || normalizedPath.includes("/"))
  ) {
    throw new Error(
      `Invalid ${friendlyName} '${relativePath}': Subdirectories are not allowed for this operation. Provide a direct filename.`
    );
  }
  // Prevent starting with a slash if it's meant to be relative, though path.isAbsolute should catch most.
  // path.normalize will remove leading './' but not a leading '/' on its own if it's not otherwise absolute.
  if (normalizedPath.startsWith(path.sep) || normalizedPath.startsWith("/")) {
    throw new Error(
      `Invalid ${friendlyName} '${relativePath}': Path should not start with a slash if relative.`
    );
  }
  return normalizedPath;
}

const mode = getParamValue("MODE") || "stdio";
const port = getParamValue("PORT") || 9591;
const endpoint = getParamValue("ENDPOINT") || "/rest";
const apiKey = process.env.API_KEY || "";

console.log("mode", mode);
console.log("port", port);
console.log("endpoint", endpoint);
console.log("apiKey", apiKey);

/**
 * Validate system configuration
 * @throws {Error} when configuration is invalid
 */
async function validateConfig(): Promise<void> {
  // Check downloads directory
  if (!fs.existsSync(CONFIG.file.downloadsDir)) {
    throw new Error(
      `Downloads directory does not exist: ${CONFIG.file.downloadsDir}`
    );
  }

  // Check downloads directory permissions
  try {
    const testFile = path.join(CONFIG.file.downloadsDir, ".write-test");
    fs.writeFileSync(testFile, "");
    fs.unlinkSync(testFile);
  } catch (error) {
    throw new Error(
      `No write permission in downloads directory: ${CONFIG.file.downloadsDir}`
    );
  }

  // Check temporary directory permissions
  try {
    const testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), CONFIG.file.tempDirPrefix)
    );
    await safeCleanup(testDir);
  } catch (error) {
    throw new Error(`Cannot create temporary directory in: ${os.tmpdir()}`);
  }
}

/**
 * Check required external dependencies
 * @throws {Error} when dependencies are not satisfied
 */
async function checkDependencies(): Promise<void> {
  for (const tool of CONFIG.tools.required) {
    try {
      await _spawnPromise(tool, ["--version"]);
    } catch (error) {
      throw new Error(
        `Required tool '${tool}' is not installed or not accessible`
      );
    }
  }
}

/**
 * Initialize service
 */
async function initialize(): Promise<void> {
  // 在測試環境中跳過初始化檢查
  if (process.env.NODE_ENV === "test") {
    return;
  }

  try {
    await validateConfig();
    await checkDependencies();
  } catch (error) {
    console.error("Initialization failed:", error);
    process.exit(1);
  }
}

const server = new McpServer(
  {
    name: "yt-dlp-mcp",
    version: VERSION,
  },
  {
    capabilities: {
      tools: {
        list: true,
        call: true,
      },
    },
  }
);

/**
 * Returns the list of available tools.
 */
server.server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      /*      {
        name: "list_subtitle_languages",
        description:
          "使用 yt-dlp 列出视频所有可用的字幕语言及其格式（包括自动生成的字幕）。得益于 yt-dlp 的强大功能，此工具支持从超过 1800 个网站获取字幕信息。",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "视频的 URL" },
          },
          required: ["url"],
        },
      },
      {
        name: "download_video_subtitles",
        description:
          "使用 yt-dlp 下载任何可用格式的视频字幕。支持从超过 1800 个网站下载常规字幕和自动生成的字幕。您可以指定字幕语言，如果未指定，则默认为英语。",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "视频的 URL" },
            language: {
              type: "string",
              description:
                "字幕的语言代码 (例如：'en', 'zh-Hant', 'ja')。如果常规字幕不可用，将尝试获取自动生成的字幕。",
            },
          },
          required: ["url"],
        },
      },*/
      {
        name: "download_video",
        description:
          "使用 yt-dlp 将视频下载到用户的默认下载文件夹 (通常是 ~/Downloads)。由于本项目基于 yt-dlp，它具备从超过 1800 个网站下载视频的能力，包括但不限于 YouTube、Vimeo、Bilibili、Facebook、Twitter 等主流平台以及众多其他各类视频网站。",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "视频的 URL" },
            resolution: {
              type: "string",
              description:
                "首选视频分辨率。对于 YouTube 等支持多种分辨率的平台：可指定 '480p'、'720p'、'1080p' 或 'best'（最高可用质量）。对于其他平台：通常 '480p' 对应标清，'720p'/'1080p' 对应高清，'best' 对应最佳质量。默认为 '720p'。",
              enum: ["480p", "720p", "1080p", "best"],
            },
          },
          required: ["url"],
        },
      },
      {
        name: "download_audio",
        description:
          "使用 yt-dlp 将指定 URL 视频的音轨以最佳可用质量（通常为 m4a 或 mp3 格式）下载到用户的默认下载文件夹 (通常是 ~/Downloads)。得益于 yt-dlp，此功能能够从超过 1800 个网站提取和下载音频内容。",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "包含音频的视频 URL" },
          },
          required: ["url"],
        },
      },
      {
        name: "publish_video",
        description:
          "将本地视频文件（位于默认下载目录）发布到在线平台，生成一个可公开访问的 URL 以供观看。",
        inputSchema: {
          type: "object",
          properties: {
            filename: {
              type: "string",
              description: "要上传的视频文件名 (例如：'my_video.mp4')",
            },
            tenantId: {
              type: "string",
              description:
                "租户 ID，用于在 R2 中组织文件路径 (例如：'user123')",
            },
            customVideoId: {
              type: "string",
              description: "（可选）自定义视频 ID。如果未提供，将自动生成。",
            },
          },
          required: ["filename", "tenantId"],
        },
      },
      {
        name: "execute_ffmpeg_command",
        description:
          "执行用户提供的 FFmpeg 命令参数字符串。强烈建议优先使用主机支持的 GPU 加速（如 NVIDIA CUDA/NVENC），以大幅提升转码速度和效率。例如：'-i input.mp4 -c:v h264_nvenc -preset fast output.mp4'。命令将在默认的视频下载目录中执行。用户需要提供 FFmpeg 命令本身之后的所有参数作为单个字符串。例如：'-i input.mp4 -vf scale=1280:720 output.mp4'。请确保输入/输出文件名正确，如果不是绝对路径，则它们是相对于下载目录的。由于 FFmpeg 功能强大且复杂，请谨慎构造命令参数。如需 CPU 编码可用 '-c:v libx264'，但推荐优先尝试 GPU 加速。",
        inputSchema: {
          type: "object",
          properties: {
            ffmpeg_args: {
              type: "string",
              description:
                "要传递给 FFmpeg 的完整参数字符串 (例如：'-i input.mp4 -ss 00:00:10 -t 00:00:05 -c copy output_segment.mp4')",
            },
          },
          required: ["ffmpeg_args"],
        },
      },
      {
        name: "speech_to_text",
        description:
          "使用 WhisperX (通过命令行) 将下载目录中的音频文件转换为文本。需要提供音频文件名，并可选择指定语言。确保已在系统中安装 whisperx 及其依赖项 (如 PyTorch, ffmpeg)。",
        inputSchema: {
          type: "object",
          properties: {
            filename: {
              type: "string",
              description:
                "位于下载目录中的音频文件名 (例如：'my_audio.m4a', 'audio.wav')",
            },
            language: {
              type: "string",
              description:
                "(可选) 音频的 BCP-47 语言代码 (例如：'en', 'zh', 'ja')。如果省略，WhisperX 会尝试自动检测语言。除非确信，否则不要对未知音源指定语言代码。",
            },
          },
          required: ["filename"],
        },
      },
      {
        name: "text_to_speech",
        description:
          "使用 Azure Cognitive Services 将文本合成为语音，并保存为 MP3 文件到下载目录。可以指定输出文件名、语言和语音。",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "要合成为语音的文本。" },
            output_filename: {
              type: "string",
              description:
                "(可选) 输出的 MP3 文件名（不含扩展名）。默认为随机 UUID。",
            },
            language: {
              type: "string",
              description:
                "(可选) 合成的语言代码 (例如：'en-US', 'zh-CN')。默认为 'en-US'。",
            },
            voice_name: {
              type: "string",
              description:
                "(可选) 使用的语音名称 (例如：'en-US-AvaMultilingualNeural')。默认为配置的默认语音。",
            },
          },
          required: ["text"],
        },
      },
      /*{
        name: "add_subtitles_to_video",
        description:
          "使用 WhisperX 为下载目录中的视频文件生成 SRT 字幕，并使用 FFmpeg 将字幕嵌入视频中。输出带有字幕的新视频文件。",
        inputSchema: {
          type: "object",
          properties: {
            input_filename: {
              type: "string",
              description:
                "位于下载目录中的原始视频文件名 (例如：'my_video.mp4')",
            },
            output_filename: {
              type: "string",
              description:
                "(可选) 输出的带字幕视频文件名 (不含路径，例如：'my_video_subtitled.mp4')。如果省略，将基于输入文件名自动生成。",
            },
            language: {
              type: "string",
              description:
                "(可选) 视频中语音的 BCP-47 语言代码 (例如：'en', 'zh', 'ja')。如果省略，WhisperX 会尝试自动检测语言。",
            },
          },
          required: ["input_filename"],
        },
      },*/
      {
        name: "execute_whisperx_command",
        description:
          "执行用户提供的 WhisperX 命令参数字符串 (通过 uvx 运行)。命令将在默认的视频下载目录中执行。用户需要提供 whisperx 命令本身之后的所有参数作为单个字符串。例如：'audio.mp3 --model large-v2 --language ja --output_format all'。请确保输入/输出文件名正确，如果不是绝对路径，则它们是相对于下载目录的。由于 WhisperX 参数复杂，请谨慎构造命令参数。",
        inputSchema: {
          type: "object",
          properties: {
            whisperx_args: {
              type: "string",
              description:
                "要传递给 WhisperX 的完整参数字符串 (例如：'audio.m4a --language en --model medium.en --output_dir output_folder --output_format txt')",
            },
          },
          required: ["whisperx_args"],
        },
      },
      {
        name: "execute_ffprobe_command",
        description:
          "执行用户提供的 ffprobe 命令参数字符串。命令将在默认的视频下载目录中执行。用户需要提供 ffprobe 命令本身之后的所有参数作为单个字符串。例如：'-v quiet -print_format json -show_format -show_streams video.mp4'。请确保输入文件名正确，如果不是绝对路径，则它们是相对于下载目录的。警告：不正确的参数可能导致命令注入漏洞，请确保参数字符串经过仔细审查，避免使用未经验证的用户输入直接构造参数，并对特殊字符进行适当处理。",
        inputSchema: {
          type: "object",
          properties: {
            ffprobe_args: {
              type: "string",
              description:
                "要传递给 ffprobe 的完整参数字符串 (例如：'-v quiet -print_format json -show_format -show_streams video.mp4')",
            },
          },
          required: ["ffprobe_args"],
        },
      },
      {
        name: "read_file",
        description: "从默认下载目录读取指定文本文件的内容。",
        inputSchema: {
          type: "object",
          properties: {
            filename: {
              type: "string",
              description:
                "位于下载目录中的文件名 (例如：'my_document.txt', 'subtitles/english.srt')。不允许使用 '..' 或绝对路径。",
            },
          },
          required: ["filename"],
        },
      },
      {
        name: "write_file",
        description:
          "将文本内容写入到默认下载目录中的指定文件。如果文件已存在，它将被覆盖。如果路径中的目录不存在，会尝试创建它们。",
        inputSchema: {
          type: "object",
          properties: {
            filename: {
              type: "string",
              description:
                "要写入的文件名，位于下载目录中 (例如：'new_notes.txt', 'data/output.json')。不允许使用 '..' 或绝对路径。",
            },
            content: {
              type: "string",
              description: "要写入文件的文本内容。",
            },
          },
          required: ["filename", "content"],
        },
      },
    ],
  };
});

/**
 * Handle tool execution with unified error handling
 * @param action Async operation to execute
 * @param errorPrefix Error message prefix
 */
async function handleToolExecution<T>(
  action: () => Promise<T>,
  errorPrefix: string
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  try {
    const result = await action();
    return {
      content: [{ type: "text", text: String(result) }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `${errorPrefix}: ${errorMessage}` }],
      isError: true,
    };
  }
}

/**
 * Handles tool execution requests.
 */
server.server.setRequestHandler(
  CallToolRequestSchema,
  async (request: CallToolRequest) => {
    const toolName = request.params.name;
    const args = request.params.arguments as {
      url?: string;
      language?: string;
      resolution?: string;
      ffmpeg_args?: string;
      filename?: string;
      tenantId?: string;
      customVideoId?: string;
      text?: string;
      output_filename?: string;
      voice_name?: string;
      input_filename?: string;
      whisperx_args?: string;
      content?: string;
      ffprobe_args?: string;
    };

    if (toolName === "list_subtitle_languages") {
      return handleToolExecution(
        () => listSubtitles(args.url as string),
        "Error listing subtitle languages"
      );
    } else if (toolName === "download_video_subtitles") {
      return handleToolExecution(
        () =>
          downloadSubtitles(
            args.url as string,
            args.language || CONFIG.download.defaultSubtitleLanguage,
            CONFIG
          ),
        "Error downloading subtitles"
      );
    } else if (toolName === "download_video") {
      console.log("download_video tool is called with args: ", args);
      return handleToolExecution(
        () =>
          downloadVideo(
            args.url as string,
            CONFIG,
            args.resolution as "480p" | "720p" | "1080p" | "best"
          ),
        "Error downloading video"
      );
    } else if (toolName === "download_audio") {
      return handleToolExecution(
        () => downloadAudio(args.url as string, CONFIG),
        "Error downloading audio"
      );
    } else if (toolName === "publish_video") {
      if (
        typeof args.filename !== "string" ||
        typeof args.tenantId !== "string"
      ) {
        return {
          content: [
            {
              type: "text",
              text: "Error: filename and tenantId must be strings.",
            },
          ],
          isError: true,
        };
      }
      return handleToolExecution(() => {
        const validatedFilename = validateIsSafeBasename(
          args.filename,
          "filename"
        );
        return HostVideoToR2(
          validatedFilename,
          args.tenantId as string,
          args.customVideoId
        );
      }, "Error publishing video");
    } else if (toolName === "execute_ffmpeg_command") {
      if (typeof args.ffmpeg_args !== "string") {
        return {
          content: [
            { type: "text", text: "Error: ffmpeg_args must be a string." },
          ],
          isError: true,
        };
      }
      return handleToolExecution(() => {
        const validatedFilename = validateIsSafeBasename(
          args.filename,
          "filename"
        );
        return speechToText(validatedFilename, args.language);
      }, "Error performing speech-to-text");
    } else if (toolName === "speech_to_text") {
      if (typeof args.filename !== "string") {
        return {
          content: [
            { type: "text", text: "Error: filename must be a string." },
          ],
          isError: true,
        };
      }
      return handleToolExecution(
        () => speechToText(args.filename as string, args.language),
        "Error performing speech-to-text"
      );
    } else if (toolName === "text_to_speech") {
      if (typeof args.text !== "string") {
        return {
          content: [{ type: "text", text: "Error: text must be a string." }],
          isError: true,
        };
      }
      return handleToolExecution(
        () =>
          textToSpeech(
            args.text as string,
            args.output_filename,
            args.language,
            args.voice_name
          ),
        "Error performing text-to-speech"
      );
    } else if (toolName === "add_subtitles_to_video") {
      if (typeof args.input_filename !== "string") {
        return {
          content: [
            {
              type: "text",
              text: "Error: input_filename must be a string.",
            },
          ],
          isError: true,
        };
      }

      const language = args.language;

      return handleToolExecution(async () => {
        const validatedInputBasename = validateIsSafeBasename(
          args.input_filename,
          "input_filename"
        );
        let validatedOutputBasename: string | undefined;
        if (args.output_filename) {
          validatedOutputBasename = validateIsSafeBasename(
            args.output_filename,
            "output_filename (optional)"
          );
        }

        const downloadsDir = CONFIG.file.downloadsDir;
        const resolvedDownloadsDir = path.resolve(downloadsDir);

        console.log(`Starting SRT generation for ${validatedInputBasename}`);
        const srtPath = await generateSrtSubtitles(
          validatedInputBasename,
          language
        );
        console.log(`SRT file generated at: ${srtPath}`);

        const resolvedSrtPath = path.resolve(srtPath);
        const tempDir = path.resolve(os.tmpdir());
        if (
          !resolvedSrtPath.startsWith(resolvedDownloadsDir) &&
          !resolvedSrtPath.startsWith(tempDir)
        ) {
          throw new Error(
            `SRT generation resulted in an unsafe or unexpected path: ${srtPath}. It must be within ${resolvedDownloadsDir} or ${tempDir}.`
          );
        }
        if (!fs.existsSync(resolvedSrtPath)) {
          throw new Error(
            `Generated SRT file not found at path: ${resolvedSrtPath}`
          );
        }

        const inputVideoPath = path.resolve(
          downloadsDir,
          validatedInputBasename
        );
        if (!inputVideoPath.startsWith(resolvedDownloadsDir)) {
          throw new Error(
            `Constructed input video path is outside the download directory: ${inputVideoPath}`
          );
        }
        if (!fs.existsSync(inputVideoPath)) {
          throw new Error(`Input video file not found: ${inputVideoPath}`);
        }

        let finalOutputVideoPath: string;
        const inputBasenameNoExt = path.basename(
          validatedInputBasename,
          path.extname(validatedInputBasename)
        );
        const outputExt = ".mp4";

        if (validatedOutputBasename) {
          const outputNamePart = path.basename(
            validatedOutputBasename,
            path.extname(validatedOutputBasename)
          );
          finalOutputVideoPath = path.resolve(
            downloadsDir,
            `${outputNamePart}${outputExt}`
          );
        } else {
          finalOutputVideoPath = path.resolve(
            downloadsDir,
            `${inputBasenameNoExt}_subtitled${outputExt}`
          );
        }

        if (!finalOutputVideoPath.startsWith(resolvedDownloadsDir)) {
          throw new Error(
            `Calculated output video path is outside the download directory: ${finalOutputVideoPath}`
          );
        }

        console.log(
          `Embedding subtitles from ${resolvedSrtPath} into ${inputVideoPath}, output to ${finalOutputVideoPath}`
        );
        await embedSubtitles(
          inputVideoPath,
          resolvedSrtPath,
          finalOutputVideoPath
        );

        try {
          await fs.promises.unlink(resolvedSrtPath);
          console.log(`Cleaned up temporary SRT file: ${resolvedSrtPath}`);
        } catch (cleanupError) {
          console.warn(
            `Failed to clean up temporary SRT file ${resolvedSrtPath}: ${cleanupError}`
          );
        }

        const outputBaseName = path.basename(finalOutputVideoPath);
        return `Subtitles successfully added. Output video: ${outputBaseName}. Access it via URL: ${CONFIG.file.hostingUrlBase}/${outputBaseName}`;
      }, "Error adding subtitles to video");
    } else if (toolName === "execute_whisperx_command") {
      if (typeof args.whisperx_args !== "string") {
        return {
          content: [
            {
              type: "text",
              text: "Error: whisperx_args must be a string.",
            },
          ],
          isError: true,
        };
      }
      return handleToolExecution(() => {
        const validatedPath = validateIsSafeRelativePath(
          args.filename,
          true,
          "filename"
        );
        return readFileContent(validatedPath);
      }, "Error reading file");
    } else if (toolName === "execute_ffprobe_command") {
      if (typeof args.ffprobe_args !== "string") {
        return {
          content: [
            { type: "text", text: "Error: ffprobe_args must be a string." },
          ],
          isError: true,
        };
      }
      return handleToolExecution(
        () => executeFFprobeCommand(args.ffprobe_args as string),
        "Error executing ffprobe command"
      );
    } else if (toolName === "read_file") {
      if (typeof args.filename !== "string") {
        return {
          content: [
            { type: "text", text: "Error: filename must be a string." },
          ],
          isError: true,
        };
      }
      return handleToolExecution(
        () => readFileContent(args.filename as string),
        "Error reading file"
      );
    } else if (toolName === "write_file") {
      if (
        typeof args.filename !== "string" ||
        typeof args.content !== "string"
      ) {
        return {
          content: [
            {
              type: "text",
              text: "Error: filename and content must be strings.",
            },
          ],
          isError: true,
        };
      }
      return handleToolExecution(() => {
        const validatedPath = validateIsSafeRelativePath(
          args.filename,
          true,
          "filename"
        );
        return writeFileContent(validatedPath, args.content as string);
      }, "Error writing file");
    } else {
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }
  }
);

async function initStreamingHttp(app: express.Application, server: McpServer) {
  // Store transports for each session type
  const transports = {
    streamable: {} as Record<string, StreamableHTTPServerTransport>,
    sse: {} as Record<string, SSEServerTransport>,
  };

  // Handle POST requests for client-to-server communication
  app.post("/mcp", async (req, res) => {
    // Check for existing session ID
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.streamable[sessionId]) {
      // Reuse existing transport
      transport = transports.streamable[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          // Store the transport by session ID
          transports.streamable[sessionId] = transport;
        },
      });

      // Clean up transport when closed
      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports.streamable[transport.sessionId];
        }
      };

      // ... set up server resources, tools, and prompts ...

      // Connect to the MCP server
      await server.connect(transport);
    } else {
      // Invalid request
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
      return;
    }

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  });

  // Reusable handler for GET and DELETE requests
  const handleSessionRequest = async (
    req: express.Request,
    res: express.Response
  ) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.streamable[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    const transport = transports.streamable[sessionId];
    await transport.handleRequest(req, res);
  };

  // Handle GET requests for server-to-client notifications via SSE
  app.get("/mcp", handleSessionRequest);

  // Handle DELETE requests for session termination
  app.delete("/mcp", handleSessionRequest);

  // Legacy SSE endpoint for older clients
  app.get("/sse", async (_, res) => {
    // Create SSE transport for legacy clients
    const transport = new SSEServerTransport("/messages", res);
    transports.sse[transport.sessionId] = transport;

    res.on("close", () => {
      delete transports.sse[transport.sessionId];
    });

    await server.connect(transport);
  });

  // Legacy message endpoint for older clients
  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports.sse[sessionId];
    if (transport) {
      await transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(400).send("No transport found for sessionId");
    }
  });
}

// 启动 MCP 服务器，支持 stdio 和 rest 两种模式
async function runServer() {
  await initialize();

  if (mode === "rest") {
    console.log(
      "使用 REST 传输，API key:",
      apiKey ? "已设置" : "未设置（认证已禁用）"
    );
    const transport = new RestServerTransport({
      port,
      endpoint,
      //...(apiKey ? { bearerToken: apiKey } : {}),
    });
    await server.connect(transport);
    await transport.startServer();

    transport.registerRoute(
      "get",
      "/download/:filename",
      (req: Request, res: Response) => {
        try {
          const userProvidedFilename = validateIsSafeBasename(
            req.params.filename,
            "requested filename"
          );

          const downloadsDir = CONFIG.file.downloadsDir; // Use configured downloads directory
          const requestedFilePath = path.join(
            downloadsDir,
            userProvidedFilename
          );

          // Final security check: resolve paths and ensure it's within downloadsDir
          const resolvedDownloadsDir = path.resolve(downloadsDir);
          const resolvedRequestedFilePath = path.resolve(requestedFilePath);

          if (!resolvedRequestedFilePath.startsWith(resolvedDownloadsDir)) {
            // This case should ideally not be reached if validateIsSafeBasename is correct
            // and userProvidedFilename has no path components.
            res
              .status(403)
              .send("Forbidden: Access to this path is not allowed.");
            return;
          }

          if (fs.existsSync(resolvedRequestedFilePath)) {
            res.download(
              resolvedRequestedFilePath,
              userProvidedFilename,
              (err) => {
                if (err) {
                  console.error("Error downloading file:", err);
                  if (!res.headersSent) {
                    // Check for common file access errors
                    if (
                      (err as NodeJS.ErrnoException).code === "ENOENT" ||
                      (err as NodeJS.ErrnoException).code === "EACCES"
                    ) {
                      res.status(404).send("File not found or access denied.");
                    } else {
                      res.status(500).send("Error downloading file");
                    }
                  }
                }
              }
            );
          } else {
            res.status(404).send("File not found");
          }
        } catch (error) {
          // Catch errors from validateIsSafeBasename or other synchronous issues
          const errorMessage =
            error instanceof Error ? error.message : "Invalid request";
          res.status(400).send(errorMessage);
        }
      }
    );
    console.error(
      `yt-dlp-mcp MCP Server 运行在 REST 模式，端口 ${port}，endpoint ${endpoint}`
    );
  } else if (mode === "ws") {
    console.log(
      `启动 WebSocket 模式，端口: ${port}, API key: ${
        apiKey ? "已设置" : "未设置（认证已禁用）"
      }`
    );

    // 1. 创建 Express 应用实例
    const app = express();
    app.use(express.json());

    const httpServer = createServer(app);
    initStreamingHttp(app, server);

    app.get("/download/:filename", (req: Request, res: Response) => {
      try {
        const userProvidedFilename = validateIsSafeBasename(
          req.params.filename,
          "requested filename"
        );

        const downloadsDir = CONFIG.file.downloadsDir; // Use configured downloads directory
        const requestedFilePath = path.join(downloadsDir, userProvidedFilename);

        // Final security check: resolve paths and ensure it's within downloadsDir
        const resolvedDownloadsDir = path.resolve(downloadsDir);
        const resolvedRequestedFilePath = path.resolve(requestedFilePath);

        if (!resolvedRequestedFilePath.startsWith(resolvedDownloadsDir)) {
          // This case should ideally not be reached if validateIsSafeBasename is correct
          res
            .status(403)
            .send("Forbidden: Access to this path is not allowed.");
          return;
        }

        if (fs.existsSync(resolvedRequestedFilePath)) {
          res.download(
            resolvedRequestedFilePath,
            userProvidedFilename,
            (err) => {
              if (err) {
                console.error("Error downloading file:", err);
                if (!res.headersSent) {
                  // Check for common file access errors
                  if (
                    (err as NodeJS.ErrnoException).code === "ENOENT" ||
                    (err as NodeJS.ErrnoException).code === "EACCES"
                  ) {
                    res.status(404).send("File not found or access denied.");
                  } else {
                    res.status(500).send("Error downloading file");
                  }
                }
              }
            }
          );
        } else {
          res.status(404).send("File not found");
        }
      } catch (error) {
        // Catch errors from validateIsSafeBasename or other synchronous issues
        const errorMessage =
          error instanceof Error ? error.message : "Invalid request";
        res.status(400).send(errorMessage);
      }
    });

    const wsTransport = new BlaxelMcpServerTransport(httpServer);
    try {
      await server.connect(wsTransport); // MCP Server 连接 transport
      console.info("Server started");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`启动 WebSocket 服务失败: ${err.message}`, err);
      process.exit(1);
    }

    // 6. 启动 HTTP 服务器 (而不是 Express 的 app.listen())
    // 因为 WebSocketServer 依赖于这个 http.Server 实例。
    httpServer.listen(port, () => {
      console.log(
        `Express server with WebSocket support is listening on port ${port}`
      );
      console.log(`HTTP endpoints accessible at http://localhost:${port}`);
      console.log(`WebSocket endpoint accessible at ws://localhost:${port}`); // 通常 WebSocket 会在同一路径，除非特殊配置
    });
  } else {
    // 兼容原有 stdio 启动
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("yt-dlp-mcp MCP Server 运行在 stdio 模式");
  }
}

// 启动服务器并处理错误
runServer().catch((error) => {
  console.error("启动服务器时发生致命错误:", error);
  process.exit(1);
});
