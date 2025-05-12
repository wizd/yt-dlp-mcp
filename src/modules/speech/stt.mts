import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { SPEECH_CONFIG } from "./config.mjs";
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
  ];
  console.log(
    `Converting to WAV: ffmpeg ${ffmpegArgs.join(" ")} in ${downloadsDir}`
  );
  try {
    await _spawnPromise("ffmpeg", ffmpegArgs, { cwd: downloadsDir });
    console.log(`Successfully converted ${inputPath} to ${outputPath}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`FFmpeg conversion failed: ${errorMessage}`);
    // Attempt to clean up potentially incomplete output file
    if (fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath);
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
 * Perform Speech-to-Text (STT) on a local audio file (WAV, MP3, M4A).
 * Converts non-WAV formats to a temporary WAV file using FFmpeg before processing.
 * @param filename - The name of the audio file (e.g., 'my_audio.wav', 'my_audio.mp3') in the downloads directory.
 * @param language - Optional language code (e.g., 'en-US', 'zh-CN'). Defaults to SPEECH_CONFIG.defaultRecognitionLanguage.
 * @returns The recognized text.
 * @throws If Azure credentials are not set, file doesn't exist, conversion fails, or recognition fails.
 */
export async function speechToText(
  filename: string,
  language?: string
): Promise<string> {
  if (
    SPEECH_CONFIG.key === "YOUR_AZURE_SPEECH_KEY" ||
    SPEECH_CONFIG.region === "YOUR_AZURE_SPEECH_REGION"
  ) {
    throw new Error(
      "Azure Speech Key or Region not configured. Please set environment variables or update config."
    );
  }

  const downloadsDir = APP_CONFIG.file.downloadsDir;
  const originalAudioPath = path.join(downloadsDir, filename);
  const fileExtension = path.extname(filename).toLowerCase();

  if (!fs.existsSync(originalAudioPath)) {
    throw new Error(`Audio file not found: ${originalAudioPath}`);
  }

  let audioInputPath = originalAudioPath; // Path to be used by Azure SDK
  let tempWavPath: string | null = null;

  try {
    // --- Conversion Step ---
    if (fileExtension === ".mp3" || fileExtension === ".m4a") {
      // Add other formats like m4a if needed
      console.log(`Format requires conversion: ${fileExtension}`);
      tempWavPath = path.join(downloadsDir, `${uuidv4()}.wav`);
      await convertToWav(originalAudioPath, tempWavPath, downloadsDir);
      audioInputPath = tempWavPath; // Use the converted WAV for recognition
    } else if (fileExtension !== ".wav") {
      throw new Error(
        `Unsupported audio format: ${fileExtension}. Only .wav, .mp3, .m4a are currently supported.`
      );
    }
    // --- End Conversion Step ---

    // --- Azure Recognition Step ---
    console.log(`Performing speech recognition on: ${audioInputPath}`);
    const speechConfig = sdk.SpeechConfig.fromSubscription(
      SPEECH_CONFIG.key,
      SPEECH_CONFIG.region
    );
    speechConfig.speechRecognitionLanguage =
      language || SPEECH_CONFIG.defaultRecognitionLanguage;

    // Always use fromWavFileInput, now pointing to either original WAV or temp WAV
    const audioConfig = sdk.AudioConfig.fromWavFileInput(
      fs.readFileSync(audioInputPath)
    );
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    return await new Promise((resolve, reject) => {
      recognizer.recognizeOnceAsync(
        (result) => {
          recognizer.close(); // Close recognizer regardless of outcome
          // Note: We don't explicitly close audioConfig here when using fromWavFileInput
          // as it reads the whole buffer. Closing is crucial for streams.
          if (result.reason === sdk.ResultReason.RecognizedSpeech) {
            console.log(`Recognition successful: ${result.text}`);
            resolve(result.text);
          } else if (result.reason === sdk.ResultReason.NoMatch) {
            console.error("Recognition failed: NoMatch");
            reject(
              new Error(
                `NOMATCH: Speech could not be recognized. Reason: ${
                  sdk.CancellationReason[result.reason]
                }`
              )
            );
          } else {
            const cancellation = sdk.CancellationDetails.fromResult(result);
            console.error(
              `Recognition failed: CANCELED. Reason=${cancellation.reason}. ErrorCode=${cancellation.ErrorCode}. Details=${cancellation.errorDetails}`
            );
            reject(
              new Error(
                `CANCELED: Reason=${cancellation.reason}. ErrorCode=${cancellation.ErrorCode}. ErrorDetails=${cancellation.errorDetails}`
              )
            );
          }
        },
        (err) => {
          recognizer.close(); // Ensure closure on error
          console.error(`Recognition failed with error: ${err}`);
          reject(new Error(`Recognition failed: ${err}`));
        }
      );
    });
    // --- End Azure Recognition Step ---
  } finally {
    // --- Cleanup Step ---
    if (tempWavPath && fs.existsSync(tempWavPath)) {
      try {
        fs.unlinkSync(tempWavPath);
        console.log(`Successfully deleted temporary WAV file: ${tempWavPath}`);
      } catch (cleanupError) {
        console.error(
          `Failed to delete temporary WAV file ${tempWavPath}: ${cleanupError}`
        );
        // Log error but don't throw, as recognition might have succeeded
      }
    }
    // --- End Cleanup Step ---
  }
}
