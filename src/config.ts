import dotenv from "dotenv";
dotenv.config();

import * as os from "os";
import * as path from "path";

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * 配置類型定義
 */
export interface Config {
  // 文件相關配置
  file: {
    maxFilenameLength: number;
    downloadsDir: string;
    tempDirPrefix: string;
    hostingUrlBase: string;
    // 文件名處理相關配置
    sanitize: {
      // 替換非法字符為此字符
      replaceChar: string;
      // 文件名截斷時的後綴
      truncateSuffix: string;
      // 非法字符正則表達式
      illegalChars: RegExp;
      // 保留字列表
      reservedNames: readonly string[];
    };
  };
  // 工具相關配置
  tools: {
    required: readonly string[];
  };
  // 下載相關配置
  download: {
    defaultResolution: "480p" | "720p" | "1080p" | "best";
    defaultAudioFormat: "m4a" | "mp3";
    defaultSubtitleLanguage: string;
  };
}

/**
 * 默認配置
 */
const defaultConfig: Config = {
  file: {
    maxFilenameLength: 50,
    downloadsDir: path.join(os.homedir(), "Downloads"),
    tempDirPrefix: "ytdlp-",
    hostingUrlBase: "/download",
    sanitize: {
      replaceChar: "_",
      truncateSuffix: "...",
      illegalChars: /[<>:"/\\|?*\x00-\x1F]/g, // Windows 非法字符
      reservedNames: [
        "CON",
        "PRN",
        "AUX",
        "NUL",
        "COM1",
        "COM2",
        "COM3",
        "COM4",
        "COM5",
        "COM6",
        "COM7",
        "COM8",
        "COM9",
        "LPT1",
        "LPT2",
        "LPT3",
        "LPT4",
        "LPT5",
        "LPT6",
        "LPT7",
        "LPT8",
        "LPT9",
      ],
    },
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

/**
 * 從環境變數加載配置
 */
function loadEnvConfig(): DeepPartial<Config> {
  const envConfig: DeepPartial<Config> = {};

  // 文件配置
  const fileConfig: DeepPartial<Config["file"]> = {
    sanitize: {
      replaceChar: process.env.YTDLP_SANITIZE_REPLACE_CHAR,
      truncateSuffix: process.env.YTDLP_SANITIZE_TRUNCATE_SUFFIX,
      illegalChars: process.env.YTDLP_SANITIZE_ILLEGAL_CHARS
        ? new RegExp(process.env.YTDLP_SANITIZE_ILLEGAL_CHARS)
        : undefined,
      reservedNames: process.env.YTDLP_SANITIZE_RESERVED_NAMES?.split(","),
    },
  };

  if (process.env.YTDLP_MAX_FILENAME_LENGTH) {
    fileConfig.maxFilenameLength = parseInt(
      process.env.YTDLP_MAX_FILENAME_LENGTH
    );
  }
  if (process.env.YTDLP_DOWNLOADS_DIR) {
    fileConfig.downloadsDir = process.env.YTDLP_DOWNLOADS_DIR;
  }
  if (process.env.YTDLP_TEMP_DIR_PREFIX) {
    fileConfig.tempDirPrefix = process.env.YTDLP_TEMP_DIR_PREFIX;
  }
  if (process.env.HOSTING_URL_BASE) {
    fileConfig.hostingUrlBase = process.env.HOSTING_URL_BASE;
  }

  if (Object.keys(fileConfig).length > 0) {
    envConfig.file = fileConfig;
  }

  // 下載配置
  const downloadConfig: Partial<Config["download"]> = {};
  if (
    process.env.YTDLP_DEFAULT_RESOLUTION &&
    ["480p", "720p", "1080p", "best"].includes(
      process.env.YTDLP_DEFAULT_RESOLUTION
    )
  ) {
    downloadConfig.defaultResolution = process.env
      .YTDLP_DEFAULT_RESOLUTION as Config["download"]["defaultResolution"];
  }
  if (
    process.env.YTDLP_DEFAULT_AUDIO_FORMAT &&
    ["m4a", "mp3"].includes(process.env.YTDLP_DEFAULT_AUDIO_FORMAT)
  ) {
    downloadConfig.defaultAudioFormat = process.env
      .YTDLP_DEFAULT_AUDIO_FORMAT as Config["download"]["defaultAudioFormat"];
  }
  if (process.env.YTDLP_DEFAULT_SUBTITLE_LANG) {
    downloadConfig.defaultSubtitleLanguage =
      process.env.YTDLP_DEFAULT_SUBTITLE_LANG;
  }
  if (Object.keys(downloadConfig).length > 0) {
    envConfig.download = downloadConfig;
  }

  return envConfig;
}

/**
 * 驗證配置
 */
function validateConfig(config: Config): void {
  // 驗證文件名長度
  if (config.file.maxFilenameLength < 5) {
    throw new Error("maxFilenameLength must be at least 5");
  }

  // 驗證下載目錄
  if (!config.file.downloadsDir) {
    throw new Error("downloadsDir must be specified");
  }

  // 驗證臨時目錄前綴
  if (!config.file.tempDirPrefix) {
    throw new Error("tempDirPrefix must be specified");
  }

  // 驗證默認分辨率
  if (
    !["480p", "720p", "1080p", "best"].includes(
      config.download.defaultResolution
    )
  ) {
    throw new Error("Invalid defaultResolution");
  }

  // 驗證默認音頻格式
  if (!["m4a", "mp3"].includes(config.download.defaultAudioFormat)) {
    throw new Error("Invalid defaultAudioFormat");
  }

  // 驗證默認字幕語言
  if (
    !/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/i.test(
      config.download.defaultSubtitleLanguage
    )
  ) {
    throw new Error("Invalid defaultSubtitleLanguage");
  }
}

/**
 * 合併配置
 */
function mergeConfig(base: Config, override: DeepPartial<Config>): Config {
  return {
    file: {
      maxFilenameLength:
        override.file?.maxFilenameLength || base.file.maxFilenameLength,
      downloadsDir: override.file?.downloadsDir || base.file.downloadsDir,
      tempDirPrefix: override.file?.tempDirPrefix || base.file.tempDirPrefix,
      hostingUrlBase: override.file?.hostingUrlBase || base.file.hostingUrlBase,
      sanitize: {
        replaceChar:
          override.file?.sanitize?.replaceChar ||
          base.file.sanitize.replaceChar,
        truncateSuffix:
          override.file?.sanitize?.truncateSuffix ||
          base.file.sanitize.truncateSuffix,
        illegalChars: (override.file?.sanitize?.illegalChars ||
          base.file.sanitize.illegalChars) as RegExp,
        reservedNames: (override.file?.sanitize?.reservedNames ||
          base.file.sanitize.reservedNames) as readonly string[],
      },
    },
    tools: {
      required: (override.tools?.required ||
        base.tools.required) as readonly string[],
    },
    download: {
      defaultResolution:
        override.download?.defaultResolution || base.download.defaultResolution,
      defaultAudioFormat:
        override.download?.defaultAudioFormat ||
        base.download.defaultAudioFormat,
      defaultSubtitleLanguage:
        override.download?.defaultSubtitleLanguage ||
        base.download.defaultSubtitleLanguage,
    },
  };
}

/**
 * 加載配置
 */
export function loadConfig(): Config {
  const envConfig = loadEnvConfig();
  const config = mergeConfig(defaultConfig, envConfig);
  validateConfig(config);
  return config;
}

/**
 * 安全的文件名處理函數
 */
export function sanitizeFilename(
  filename: string,
  config: Config["file"]
): string {
  // 移除非法字符
  let safe = filename.replace(
    config.sanitize.illegalChars,
    config.sanitize.replaceChar
  );

  // 檢查保留字
  const basename = path.parse(safe).name.toUpperCase();
  if (config.sanitize.reservedNames.includes(basename)) {
    safe = `_${safe}`;
  }

  // 處理長度限制
  if (safe.length > config.maxFilenameLength) {
    const ext = path.extname(safe);
    const name = safe.slice(
      0,
      config.maxFilenameLength -
        ext.length -
        config.sanitize.truncateSuffix.length
    );
    safe = `${name}${config.sanitize.truncateSuffix}${ext}`;
  }

  return safe;
}

// 導出當前配置實例
export const CONFIG = loadConfig();
