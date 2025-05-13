import { CONFIG } from "../config.js";
import { _spawnPromise } from "./utils.js";
import stringArgv from "string-argv";

/**
 * Executes a WhisperX command with the given arguments string.
 * The command will be executed via 'uvx' in the default downloads directory.
 *
 * @param whisperxUserArgsString - A string containing all arguments to pass to the whisperx script
 *                                (e.g., "audio.wav --model large-v2 --language en --output_format srt").
 *                                The string can optionally start with "whisperx", which will be stripped.
 * @returns Promise resolving to the whisperx command's output (stdout and stderr).
 * @throws {Error} When whisperx arguments are empty or the command execution fails.
 */
export async function executeWhisperxCommand(
  whisperxUserArgsString: string
): Promise<string> {
  const downloadsDir = CONFIG.file.downloadsDir;

  if (!whisperxUserArgsString || whisperxUserArgsString.trim() === "") {
    throw new Error("WhisperX arguments string cannot be empty.");
  }

  // Use string-argv to parse the arguments string into an array,
  // handling quotes and escapes robustly.
  let parsedUserArgs: string[];
  try {
    parsedUserArgs = stringArgv(whisperxUserArgsString);
  } catch (e: unknown) {
    // string-argv throws an error for unmatched quotes or other parsing issues
    throw new Error(
      `Could not parse whisperx_args: "${whisperxUserArgsString}". ` +
        `Error: ${
          e instanceof Error ? e.message : String(e)
        }. Ensure quotes are balanced and arguments are correctly formatted.`
    );
  }

  if (parsedUserArgs.length === 0 && whisperxUserArgsString.trim() !== "") {
    throw new Error(
      `Could not parse whisperx_args: "${whisperxUserArgsString}". ` +
        `The arguments string was not empty but resulted in no arguments after parsing. ` +
        `Ensure arguments are properly quoted if they contain spaces. E.g., "my audio file.wav" --model tiny`
    );
  }

  const mutableUserArgs = [...parsedUserArgs];

  // If the first argument is 'whisperx' (case-insensitive), remove it,
  // as we will prepend 'whisperx' as the first argument to 'uvx' later.
  if (
    mutableUserArgs.length > 0 &&
    mutableUserArgs[0].toLowerCase() === "whisperx"
  ) {
    mutableUserArgs.shift();
  }

  // Prepend "whisperx" as the first actual argument to the script executed by uvx
  const finalWhisperxScriptArgs = ["whisperx", ...mutableUserArgs];

  // Ensure there are actual arguments for whisperx itself (e.g., input file)
  // "whisperx" alone (after our prepending) is not enough.
  if (finalWhisperxScriptArgs.length <= 1 && mutableUserArgs.length === 0) {
    throw new Error(
      "No effective arguments provided for WhisperX. Please specify at least an input file and any desired options."
    );
  }

  try {
    console.log(
      `Executing WhisperX in CWD: ${downloadsDir} with command: uvx ${finalWhisperxScriptArgs.join(
        " "
      )}`
    );
    // 'uvx' is the command, and 'finalWhisperxScriptArgs' are its arguments,
    // where the first one is "whisperx" indicating the script to run.
    const output = await _spawnPromise("uvx", finalWhisperxScriptArgs, {
      cwd: downloadsDir,
    });
    console.log("WhisperX command executed successfully.");
    return `WhisperX command executed successfully in ${downloadsDir}.
Output:
${output}`;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("WhisperX command failed: " + errorMessage);
    throw new Error(
      `WhisperX command failed when run in ${downloadsDir}.
Command: uvx ${finalWhisperxScriptArgs.join(" ")}
Error: ${errorMessage}`
    );
  }
}
