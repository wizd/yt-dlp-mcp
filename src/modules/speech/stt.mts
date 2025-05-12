import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { v4 as uuidv4 } from "uuid";
import { CONFIG as APP_CONFIG } from "../../config.js";
import { _spawnPromise } from "../utils.js";

/**
 * Converts audio file to WAV format using FFmpeg.
 * Specifically, converts to 16kHz, 16-bit PCM mono WAV, suitable for Azure Speech SDK.
 * @param inputPath - Full path to the input audio file.
 * @param outputPath - Full path for the temporary WAV output file.
 * @param downloadsDir - Directory where FFmpeg command should be executed.
 * @throws If FFmpeg command fails.
 */
async function convertToWav(
  inputPath: string,
  outputPath: string,
  downloadsDir: string
): Promise<void> {
  const ffmpegArgs = [
    "-i",
    inputPath,
    "-vn", // No video output
    "-acodec",
    "pcm_s16le", // Output codec: 16-bit signed little-endian PCM
    "-ar",
    "16000", // Output sample rate: 16kHz
    "-ac",
    "1", // Output channels: mono
    outputPath,
    "-y", // Overwrite output file if it exists
  ];
  console.log(
    `Converting to WAV: ffmpeg ${ffmpegArgs.join(" ")} in ${downloadsDir}`
  );
  try {
    // Using absolute paths, cwd might not be strictly necessary but safer
    await _spawnPromise("ffmpeg", ffmpegArgs, { cwd: downloadsDir });
    console.log(`Successfully converted ${inputPath} to ${outputPath}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`FFmpeg conversion failed: ${errorMessage}`);
    // Attempt to clean up potentially incomplete output file
    if (fs.existsSync(outputPath)) {
      try {
        // Use async unlink for consistency if available, otherwise sync is fine in cleanup
        await fs.promises.unlink(outputPath);
      } catch (cleanupError) {
        console.error(
          `Failed to cleanup temp WAV file ${outputPath}: ${cleanupError}`
        );
      }
    }
    throw new Error(
      `FFmpeg conversion failed for ${inputPath}. Error: ${errorMessage}`
    );
  }
}

/**
 * Perform Speech-to-Text (STT) on a local audio file using WhisperX CLI.
 * Converts non-WAV formats to a temporary WAV file using FFmpeg before processing.
 * Requires whisperx to be installed and accessible in the system PATH.
 * @param filename - The name of the audio file (e.g., 'my_audio.wav', 'my_audio.mp3', 'my_audio.m4a') in the downloads directory.
 * @param language - Optional language code (e.g., 'en', 'zh', 'ja'). If omitted, whisperx will attempt auto-detection.
 * @returns The recognized text.
 * @throws If file doesn't exist, conversion fails, or whisperx execution fails.
 */
export async function speechToText(
  filename: string,
  language?: string
): Promise<string> {
  const downloadsDir = APP_CONFIG.file.downloadsDir;
  const originalAudioPath = path.join(downloadsDir, filename);
  const fileExtension = path.extname(filename).toLowerCase();

  if (!fs.existsSync(originalAudioPath)) {
    throw new Error(`Audio file not found: ${originalAudioPath}`);
  }

  let audioInputPath = originalAudioPath; // Path to be used by whisperx
  let tempWavPath: string | null = null;
  let tempOutputDir: string | null = null; // For whisperx output

  try {
    // --- Conversion Step (Kept for broader compatibility) ---
    if (fileExtension !== ".wav") {
      console.log(
        `Input is not WAV (${fileExtension}). Converting to 16kHz mono WAV for whisperx.`
      );
      tempWavPath = path.join(downloadsDir, `${uuidv4()}.wav`);
      await convertToWav(originalAudioPath, tempWavPath, downloadsDir);
      audioInputPath = tempWavPath; // Use the converted WAV
    } else {
      console.log("Input is WAV, proceeding directly with whisperx.");
    }
    // --- End Conversion Step ---

    // --- WhisperX Recognition Step ---
    console.log(
      `Performing speech recognition via whisperx on: ${audioInputPath}`
    );
    tempOutputDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "whisperx-out-")
    );

    const whisperxArgs = [
      "whisperx",
      audioInputPath,
      "--output_dir",
      tempOutputDir,
      "--output_format",
      "txt",
      "--model",
      "large-v2", // High accuracy model
      "--compute_type",
      "int8", // Good balance for CPU/GPU compatibility
      "--condition_on_previous_text",
      "False",
      "--suppress_numerals",
      "--verbose",
      "False",
    ];

    if (language) {
      whisperxArgs.push("--language", language);
      console.log(`Using specified language for whisperx: ${language}`);
    } else {
      console.log(
        "No language specified; whisperx will attempt auto-detection."
      );
    }

    console.log(
      `Executing whisperx command: whisperx ${whisperxArgs.join(" ")}`
    );

    // Execute whisperx via command line
    // Ensure _spawnPromise throws on error (non-zero exit code)
    await _spawnPromise("uvx", whisperxArgs);

    // Construct the expected output file path
    const outputTxtFilename =
      path.basename(audioInputPath, path.extname(audioInputPath)) + ".txt";
    const outputTxtPath = path.join(tempOutputDir, outputTxtFilename);

    if (!fs.existsSync(outputTxtPath)) {
      throw new Error(
        `WhisperX command completed, but the expected output file was not found: ${outputTxtPath}. Check whisperx logs or permissions.`
      );
    }

    // Read the result from the generated text file
    const recognizedText = await fs.promises.readFile(outputTxtPath, "utf-8");
    console.log(
      `WhisperX recognition successful. Output read from: ${outputTxtPath}`
    );

    return recognizedText.trim();
    // --- End WhisperX Recognition Step ---
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Speech-to-text processing failed: ${errorMessage}`);
    // Optionally log the full error: console.error(error);
    throw new Error(
      `WhisperX STT failed for ${filename}. Error: ${errorMessage}`
    );
  } finally {
    // --- Cleanup Step ---
    console.log("Cleaning up temporary files...");
    if (tempWavPath && fs.existsSync(tempWavPath)) {
      try {
        await fs.promises.unlink(tempWavPath);
        console.log(`Successfully deleted temporary WAV file: ${tempWavPath}`);
      } catch (cleanupError) {
        console.error(
          `Failed to delete temporary WAV file ${tempWavPath}: ${cleanupError}`
        );
      }
    }
    if (tempOutputDir) {
      try {
        await fs.promises.rm(tempOutputDir, { recursive: true, force: true });
        console.log(
          `Successfully deleted temporary output directory: ${tempOutputDir}`
        );
      } catch (cleanupError) {
        console.error(
          `Failed to delete temporary output directory ${tempOutputDir}: ${cleanupError}`
        );
      }
    }
    console.log("Cleanup finished.");
    // --- End Cleanup Step ---
  }
}
