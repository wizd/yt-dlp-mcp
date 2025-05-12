import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import * as fs from "fs";
import * as path from "path";
import { SPEECH_CONFIG } from "./config.mjs"; // 使用编译后的 .js 扩展名
import { CONFIG as APP_CONFIG } from "../../config.js"; // 保留 .js 后缀

/**
 * Perform Speech-to-Text (STT) on a local audio file.
 * @param filename - The name of the audio file in the downloads directory.
 * @param language - Optional language code (e.g., 'en-US', 'zh-CN'). Defaults to SPEECH_CONFIG.defaultRecognitionLanguage.
 * @returns The recognized text.
 * @throws If Azure credentials are not set, file doesn't exist, or recognition fails.
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

  const audioFilePath = path.join(APP_CONFIG.file.downloadsDir, filename);
  if (!fs.existsSync(audioFilePath)) {
    throw new Error(`Audio file not found: ${audioFilePath}`);
  }

  const speechConfig = sdk.SpeechConfig.fromSubscription(
    SPEECH_CONFIG.key,
    SPEECH_CONFIG.region
  );
  speechConfig.speechRecognitionLanguage =
    language || SPEECH_CONFIG.defaultRecognitionLanguage;

  const audioConfig = sdk.AudioConfig.fromWavFileInput(
    fs.readFileSync(audioFilePath)
  );
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

  return new Promise((resolve, reject) => {
    recognizer.recognizeOnceAsync(
      (result) => {
        recognizer.close();
        if (result.reason === sdk.ResultReason.RecognizedSpeech) {
          resolve(result.text);
        } else if (result.reason === sdk.ResultReason.NoMatch) {
          reject(
            new Error(
              `NOMATCH: Speech could not be recognized. Reason: ${
                sdk.CancellationReason[result.reason]
              }`
            )
          );
        } else {
          const cancellation = sdk.CancellationDetails.fromResult(result);
          reject(
            new Error(
              `CANCELED: Reason=${cancellation.reason}. ErrorCode=${cancellation.ErrorCode}. ErrorDetails=${cancellation.errorDetails}`
            )
          );
        }
      },
      (err) => {
        recognizer.close();
        reject(new Error(`Recognition failed: ${err}`));
      }
    );
  });
}
