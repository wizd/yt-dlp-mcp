import * as fs from "fs";
import * as path from "path";
import { CONFIG } from "../config.js";

/**
 * Resolves a filename to an absolute path within the configured downloads directory
 * and performs security checks to prevent path traversal.
 *
 * @param filename - The filename provided by the user.
 * @param downloadsDir - The configured downloads directory.
 * @returns The absolute, validated path.
 * @throws If the filename is invalid or attempts to escape the downloads directory.
 */
function resolveAndValidatePath(
  filename: string,
  downloadsDir: string
): string {
  if (!filename || filename.includes("..") || path.isAbsolute(filename)) {
    throw new Error(
      "Invalid filename. Must be a relative path without traversal components ('..')."
    );
  }

  const fullPath = path.resolve(downloadsDir, filename);

  // Security Check: Ensure the resolved path is still within the downloads directory
  if (!fullPath.startsWith(path.resolve(downloadsDir) + path.sep)) {
    // Check if it's exactly the downloadsDir itself (if filename was '.')
    if (fullPath !== path.resolve(downloadsDir)) {
      throw new Error("Path traversal attempt detected. Access denied.");
    }
    // Allow access to the directory itself if needed, though file ops will likely fail
  }

  return fullPath;
}

/**
 * Reads the content of a text file from the configured downloads directory.
 *
 * @param filename - The name of the file within the downloads directory (e.g., 'subtitles.srt').
 * @returns The content of the file as a string.
 * @throws If the file doesn't exist, cannot be accessed, or path is invalid.
 */
export async function readFileContent(filename: string): Promise<string> {
  const downloadsDir = CONFIG.file.downloadsDir;
  const filePath = resolveAndValidatePath(filename, downloadsDir);

  try {
    // Check if path exists and is a file
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) {
      throw new Error(`Path exists but is not a file: ${filename}`);
    }

    const content = await fs.promises.readFile(filePath, "utf-8");
    return content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`File not found in downloads directory: ${filename}`);
    } else if ((error as NodeJS.ErrnoException).code === "EACCES") {
      throw new Error(`Permission denied reading file: ${filename}`);
    }
    // Re-throw other errors or specifically handle them
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error reading file ${filePath}: ${errorMessage}`);
    // Throw a generic error for security, avoid leaking path details potentially
    throw new Error(
      `Failed to read file: ${filename}. Reason: ${errorMessage}`
    );
  }
}

/**
 * Writes text content to a file in the configured downloads directory.
 * This will overwrite the file if it already exists.
 *
 * @param filename - The name of the file within the downloads directory (e.g., 'translated_subs.srt').
 * @param content - The text content to write to the file.
 * @returns A success message.
 * @throws If the path is invalid or writing fails.
 */
export async function writeFileContent(
  filename: string,
  content: string
): Promise<string> {
  const downloadsDir = CONFIG.file.downloadsDir;
  const filePath = resolveAndValidatePath(filename, downloadsDir);

  try {
    // Ensure the directory exists (writeFile doesn't create intermediate dirs)
    // Since we restrict to downloadsDir, it should exist, but good practice.
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    await fs.promises.writeFile(filePath, content, "utf-8");
    const savedFilename = path.basename(filePath);
    return `Successfully wrote content to file: ${savedFilename} in downloads directory.`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EACCES") {
      throw new Error(`Permission denied writing to file: ${filename}`);
    } else if ((error as NodeJS.ErrnoException).code === "EISDIR") {
      throw new Error(`Cannot write file, path is a directory: ${filename}`);
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error writing file ${filePath}: ${errorMessage}`);
    throw new Error(
      `Failed to write file: ${filename}. Reason: ${errorMessage}`
    );
  }
}
