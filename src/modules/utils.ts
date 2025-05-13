import * as fs from 'fs';
import { spawn, SpawnOptionsWithoutStdio } from "child_process";
import { randomBytes } from "crypto";

/**
 * Validates if a given string is a valid URL.
 *
 * @param url - The URL string to validate
 * @returns True if the URL is valid, false otherwise
 *
 * @example
 * ```typescript
 * if (validateUrl('https://youtube.com/watch?v=...')) {
 *   // URL is valid
 * }
 * ```
 */
export function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if a URL is from YouTube.
 *
 * @param url - The URL to check
 * @returns True if the URL is from YouTube, false otherwise
 *
 * @example
 * ```typescript
 * if (isYouTubeUrl('https://youtube.com/watch?v=...')) {
 *   // URL is from YouTube
 * }
 * ```
 */
export function isYouTubeUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return (
      parsedUrl.hostname.includes("youtube.com") ||
      parsedUrl.hostname.includes("youtu.be")
    );
  } catch {
    return false;
  }
}

/**
 * Safely cleans up a directory and its contents.
 *
 * @param directory - Path to the directory to clean up
 * @returns Promise that resolves when cleanup is complete
 * @throws {Error} When directory cannot be removed
 *
 * @example
 * ```typescript
 * try {
 *   await safeCleanup('/path/to/temp/dir');
 * } catch (error) {
 *   console.error('Cleanup failed:', error);
 * }
 * ```
 */
export async function safeCleanup(directory: string): Promise<void> {
  try {
    await fs.promises.rm(directory, { recursive: true, force: true });
  } catch (error) {
    console.error(`Error cleaning up directory ${directory}:`, error);
  }
}

/**
 * Spawns a child process and returns its output as a promise.
 *
 * @param command - The command to execute
 * @param args - Array of command arguments
 * @param options - Optional SpawnOptionsWithoutStdio options
 * @returns Promise resolving to the command output
 * @throws {Error} When command execution fails
 *
 * @example
 * ```typescript
 * try {
 *   const output = await _spawnPromise('yt-dlp', ['--version']);
 *   console.log('yt-dlp version:', output);
 * } catch (error) {
 *   console.error('Command failed:', error);
 * }
 * ```
 */
export function _spawnPromise(
  command: string,
  args: string[],
  options?: SpawnOptionsWithoutStdio
): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, options);
    let output = "";

    process.stdout.on("data", (data) => {
      output += data.toString();
    });

    process.stderr.on("data", (data) => {
      output += data.toString();
    });

    process.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`Failed with exit code: ${code}\n${output}`));
      }
    });

    // Add error handling for spawn itself
    process.on("error", (err) => {
      reject(
        new Error(
          `Spawn error for command ${command}: ${err.message}\n${output}`
        )
      );
    });
  });
}

/**
 * Generates a formatted timestamp string for file naming.
 * 
 * @returns Formatted timestamp string in the format 'YYYY-MM-DD_HH-mm-ss'
 * 
 * @example
 * ```typescript
 * const timestamp = getFormattedTimestamp();
 * console.log(timestamp); // '2024-03-20_12-30-00'
 * ```
 */
export function getFormattedTimestamp(): string {
  return new Date().toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .split('.')[0];
}

/**
 * Generates a random filename with timestamp prefix.
 * 
 * @param extension - Optional file extension (default: 'mp4')
 * @returns A random filename with timestamp
 * 
 * @example
 * ```typescript
 * const filename = generateRandomFilename('mp3');
 * console.log(filename); // '2024-03-20_12-30-00_a1b2c3d4.mp3'
 * ```
 */
export function generateRandomFilename(extension: string = 'mp4'): string {
  const timestamp = getFormattedTimestamp();
  const randomId = randomBytes(4).toString('hex');
  return `${timestamp}_${randomId}.${extension}`;
} 