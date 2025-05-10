#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
import { listSubtitles, downloadSubtitles } from "./modules/subtitle.js";
import { RestServerTransport } from "@wizdy/typescript-sdk/server/rest.js";
import { getParamValue } from "@wizdy/typescript-sdk/utils/index.js";
import { Request, Response } from "express";

const VERSION = "0.6.26";

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

const server = new Server(
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
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_subtitle_languages",
        description:
          "List all available subtitle languages and their formats for a video (including auto-generated captions)",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL of the video" },
          },
          required: ["url"],
        },
      },
      {
        name: "download_video_subtitles",
        description:
          "Download video subtitles in any available format. Supports both regular and auto-generated subtitles in various languages.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL of the video" },
            language: {
              type: "string",
              description:
                "Language code (e.g., 'en', 'zh-Hant', 'ja'). Will try to get auto-generated subtitles if regular subtitles are not available.",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "download_video",
        description:
          "Download video to the user's default Downloads folder (usually ~/Downloads).",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL of the video" },
            resolution: {
              type: "string",
              description:
                "Preferred video resolution. For YouTube: '480p', '720p', '1080p', 'best'. For other platforms: '480p' for low quality, '720p'/'1080p' for HD, 'best' for highest quality. Defaults to '720p'",
              enum: ["480p", "720p", "1080p", "best"],
            },
          },
          required: ["url"],
        },
      },
      {
        name: "download_audio",
        description:
          "Download audio in best available quality (usually m4a/mp3 format) to the user's default Downloads folder (usually ~/Downloads).",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL of the video" },
          },
          required: ["url"],
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
server.setRequestHandler(
  CallToolRequestSchema,
  async (request: CallToolRequest) => {
    const toolName = request.params.name;
    const args = request.params.arguments as {
      url: string;
      language?: string;
      resolution?: string;
    };

    if (toolName === "list_subtitle_languages") {
      return handleToolExecution(
        () => listSubtitles(args.url),
        "Error listing subtitle languages"
      );
    } else if (toolName === "download_video_subtitles") {
      return handleToolExecution(
        () =>
          downloadSubtitles(
            args.url,
            args.language || CONFIG.download.defaultSubtitleLanguage,
            CONFIG
          ),
        "Error downloading subtitles"
      );
    } else if (toolName === "download_video") {
      return handleToolExecution(
        () =>
          downloadVideo(
            args.url,
            CONFIG,
            args.resolution as "480p" | "720p" | "1080p" | "best"
          ),
        "Error downloading video"
      );
    } else if (toolName === "download_audio") {
      return handleToolExecution(
        () => downloadAudio(args.url, CONFIG),
        "Error downloading audio"
      );
    } else {
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }
  }
);

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
      //supportTenantId: true, // 启用多租户支持
      ...(apiKey ? { bearerToken: apiKey } : {}), // 仅在apiKey有值时启用认证
    });
    await server.connect(transport);
    await transport.startServer();

    // 注册一个文件下载路由
    transport.registerRoute(
      "get",
      "/download/:filename",
      (req: Request, res: Response) => {
        // Request 和 Response 类型现在与 express.RequestHandler 兼容
        const filename = req.params.filename;
        if (!filename) {
          res.status(400).send("Filename is required");
          return;
        }
        // Ensure filename is just a filename and not a path
        const sanitizedFilename = path.basename(filename);
        if (sanitizedFilename !== filename) {
          // Prevent directory traversal
          res.status(400).send("Invalid filename");
          return;
        }
        const downloadsDir = path.join(os.homedir(), "Downloads");
        const filePath = path.join(downloadsDir, sanitizedFilename);

        // Check if file exists and then send
        if (fs.existsSync(filePath)) {
          res.download(filePath, sanitizedFilename, (err) => {
            if (err) {
              // Handle error, but headers may have already been sent
              console.error("Error downloading file:", err);
              if (!res.headersSent) {
                res.status(500).send("Error downloading file");
              }
            }
          });
        } else {
          res.status(404).send("File not found");
        }
      }
    );

    console.error(
      `yt-dlp-mcp MCP Server 运行在 REST 模式，端口 ${port}，endpoint ${endpoint}`
    );
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
