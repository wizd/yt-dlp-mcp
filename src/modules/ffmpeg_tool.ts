import { CONFIG } from "../config.js";
import { _spawnPromise } from "./utils.js";
import stringArgv from "string-argv";

/**
 * Executes an FFmpeg command with the given arguments string.
 * The command will be executed in the default downloads directory specified in the config.
 *
 * @param ffmpegArgsString - A string containing all arguments to pass to the ffmpeg command
 *                           (e.g., "-i input.mp4 -vf scale=640:-1 output.mp4").
 *                           The string can optionally start with "ffmpeg", which will be stripped.
 * @returns Promise resolving to the ffmpeg command's output (stdout and stderr).
 * @throws {Error} When ffmpeg arguments are empty or the command execution fails.
 */
export async function executeFFmpegCommand(
  ffmpegArgsString: string
): Promise<string> {
  const downloadsDir = CONFIG.file.downloadsDir;

  if (!ffmpegArgsString || ffmpegArgsString.trim() === "") {
    throw new Error("FFmpeg arguments string cannot be empty.");
  }

  // Use string-argv to parse the arguments string into an array,
  // handling quotes and escapes robustly.
  let parsedArgs: string[];
  try {
    parsedArgs = stringArgv(ffmpegArgsString);
  } catch (e: unknown) {
    // string-argv throws an error for unmatched quotes or other parsing issues
    throw new Error(
      `Could not parse ffmpeg_args: "${ffmpegArgsString}". ` +
        `Error: ${
          e instanceof Error ? e.message : String(e)
        }. Ensure quotes are balanced and arguments are correctly formatted.`
    );
  }

  if (parsedArgs.length === 0 && ffmpegArgsString.trim() !== "") {
    throw new Error(
      `Could not parse ffmpeg_args: "${ffmpegArgsString}". ` +
        `The arguments string was not empty but resulted in no arguments after parsing. ` +
        `Ensure arguments are properly quoted if they contain spaces and that the overall format is correct. E.g., -i "my video.mp4" -an out.mp3`
    );
  }

  // Create a mutable copy of the parsed arguments.
  const finalArgs = [...parsedArgs];

  // If the first argument is 'ffmpeg' (case-insensitive), remove it.
  if (finalArgs.length > 0 && finalArgs[0].toLowerCase() === "ffmpeg") {
    finalArgs.shift();
  }

  // If, after potentially stripping "ffmpeg", the arguments are empty, it might mean the input was just "ffmpeg".
  // Calling ffmpeg with no arguments usually shows help text, which can be considered valid output.
  // However, if the original string was *only* "ffmpeg" and nothing else,
  // and we want to prevent calling ffmpeg without any actual operation, we could add a check here.
  // For now, we'll allow it, as ffmpeg handles it by showing help.

  // Ensure -y is present for non-interactive overwrite, unless -n is specified.
  const hasOverwriteFlag = finalArgs.some(
    (arg) => arg === "-y" || arg === "-n"
  );
  if (!hasOverwriteFlag) {
    finalArgs.unshift("-y"); // Prepend -y to force overwrite
  }

  try {
    console.log(
      `Executing FFmpeg in CWD: ${downloadsDir} with command: ffmpeg ${finalArgs.join(
        " "
      )}`
    );
    const output = await _spawnPromise("ffmpeg", finalArgs, {
      cwd: downloadsDir,
    });
    console.log("ffmpeg command executed successfully.");
    return `FFmpeg command executed successfully in ${downloadsDir}.
Output:
${output}`;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("ffmpeg command failed." + errorMessage);
    throw new Error(
      `FFmpeg command failed when run in ${downloadsDir}.
Arguments: ffmpeg ${finalArgs.join(" ")}
Error: ${errorMessage}`
    );
  }
}
