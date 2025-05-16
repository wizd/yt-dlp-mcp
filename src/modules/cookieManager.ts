import * as path from "path";
import { isYouTubeUrl } from "./utils.js";

// Helper function to determine if the URL is from x.com or twitter.com
function isXcomUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return (
      parsedUrl.hostname.endsWith("x.com") ||
      parsedUrl.hostname.endsWith("twitter.com")
    );
  } catch (error) {
    // Invalid URL
    return false;
  }
}

/**
 * Gets the appropriate cookie file path based on the video URL.
 * Cookie files are expected to be in the 'src/' directory.
 *
 * @param url - The URL of the video.
 * @returns The absolute path to the cookie file, or null if no specific cookie is needed.
 */
export function getCookieFilePath(url: string): string | null {
  let cookieFileName: string | null = null;

  if (isYouTubeUrl(url)) {
    cookieFileName = "yt-cookies.txt";
  } else if (isXcomUrl(url)) {
    cookieFileName = "x-cookies.txt";
  }

  if (cookieFileName) {
    // Assuming cookieManager.ts is in src/modules/,
    // path.dirname(new URL(import.meta.url).pathname) gives the path to src/modules/
    // Then "../" navigates up to src/
    // For Node.js ESM, import.meta.url provides the file URL.
    // For file URLs, new URL(...).pathname correctly decodes and gives the system path.
    // Ensure that the path correctly resolves, especially if dealing with 'file://' prefixes on different OS.
    // On Linux/macOS, new URL('file:///path/to/file').pathname is '/path/to/file'
    // On Windows, new URL('file:///C:/path/to/file').pathname is '/C:/path/to/file'

    // A more robust way to get the directory of the current module:
    const currentModulePath = new URL(import.meta.url).pathname;
    // On Windows, pathname starts with an extra '/' e.g., /C:/...
    // We need to remove it if present and if on Windows.
    const correctlyDecodedModulePath =
      process.platform === "win32" && currentModulePath.startsWith("/")
        ? currentModulePath.substring(1)
        : currentModulePath;

    const currentModuleDir = path.dirname(correctlyDecodedModulePath);

    return path.resolve(
      currentModuleDir, // src/modules/
      "..", // up to src/
      cookieFileName // e.g., yt-cookies.txt or x-cookies.txt
    );
  }

  return null;
}
