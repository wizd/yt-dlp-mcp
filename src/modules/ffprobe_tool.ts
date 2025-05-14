import { CONFIG } from "../config.js";
import { _spawnPromise } from "./utils.js";
import stringArgv from "string-argv";

/**
 * Executes an ffprobe command with the given arguments string.
 * The command will be executed in the default downloads directory specified in the config.
 *
 * @param ffprobeArgsString - A string containing all arguments to pass to the ffprobe command
 *                           (e.g., "-v quiet -print_format json -show_format -show_streams video.mp4").
 *                           The string can optionally start with "ffprobe", which will be stripped.
 * @returns Promise resolving to the ffprobe command's output (stdout).
 * @throws {Error} When ffprobe arguments are empty or the command execution fails.
 */
export async function executeFFprobeCommand(
  ffprobeArgsString: string
): Promise<string> {
  const downloadsDir = CONFIG.file.downloadsDir;

  if (!ffprobeArgsString || ffprobeArgsString.trim() === "") {
    throw new Error("ffprobe arguments string cannot be empty.");
  }

  // Use string-argv to parse the arguments string into an array,
  // handling quotes and escapes robustly.
  let parsedArgs: string[];
  try {
    parsedArgs = stringArgv(ffprobeArgsString);
  } catch (e: unknown) {
    // string-argv throws an error for unmatched quotes or other parsing issues
    throw new Error(
      `Could not parse ffprobe_args: "${ffprobeArgsString}". ` +
        `Error: ${
          e instanceof Error ? e.message : String(e)
        }. Ensure quotes are balanced and arguments are correctly formatted.`
    );
  }

  if (parsedArgs.length === 0 && ffprobeArgsString.trim() !== "") {
    throw new Error(
      `Could not parse ffprobe_args: "${ffprobeArgsString}". ` +
        `The arguments string was not empty but resulted in no arguments after parsing. ` +
        `Ensure arguments are properly quoted if they contain spaces and that the overall format is correct. E.g., -show_format "my video.mp4"`
    );
  }

  // Create a mutable copy of the parsed arguments.
  const finalArgs = [...parsedArgs];

  // If the first argument is 'ffprobe' (case-insensitive), remove it.
  if (finalArgs.length > 0 && finalArgs[0].toLowerCase() === "ffprobe") {
    finalArgs.shift();
  }

  // Unlike ffmpeg, ffprobe doesn't typically overwrite files, so -y isn't needed.
  // It's primarily for reading information.

  try {
    console.log(
      `Executing ffprobe in CWD: ${downloadsDir} with command: ffprobe ${finalArgs.join(
        " "
      )}`
    );
    // ffprobe output is usually desired from stdout
    const output = await _spawnPromise("ffprobe", finalArgs, {
      cwd: downloadsDir,
    });
    console.log("ffprobe command executed successfully.");
    // ffprobe usually outputs to stdout, stderr might contain progress or less relevant info for data extraction.
    // We return stdout directly, which is what _spawnPromise resolves with on success.
    return output;
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    const errorMessage = err.stderr || err.message || String(error);
    console.error("ffprobe command failed." + errorMessage);
    throw new Error(
      `ffprobe command failed when run in ${downloadsDir}.
Arguments: ffprobe ${finalArgs.join(" ")}
Error: ${errorMessage}`
    );
  }
}
