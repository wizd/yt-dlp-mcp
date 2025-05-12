import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import * as path from "path";
import { SPEECH_CONFIG } from "./config.mjs"; // 使用编译后的 .js 扩展名
import { CONFIG as APP_CONFIG } from "../../config.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Perform Text-to-Speech (TTS) and save the audio to a file.
 * @param text - The text to synthesize.
 * @param outputFilename - Optional. The desired output filename (without extension, e.g., 'my_speech'). Defaults to a random UUID.
 * @param language - Optional language code (e.g., 'en-US', 'zh-CN'). Defaults to SPEECH_CONFIG.defaultSynthesisLanguage.
 * @param voiceName - Optional voice name (e.g., 'en-US-AvaMultilingualNeural'). Defaults to SPEECH_CONFIG.defaultSynthesisVoice.
 * @returns The full path to the generated audio file (mp3 format).
 * @throws If Azure credentials are not set or synthesis fails.
 */
export async function textToSpeech(
  text: string,
  outputFilename?: string,
  language?: string,
  voiceName?: string
): Promise<string> {
  if (
    SPEECH_CONFIG.key === "YOUR_AZURE_SPEECH_KEY" ||
    SPEECH_CONFIG.region === "YOUR_AZURE_SPEECH_REGION"
  ) {
    throw new Error(
      "Azure Speech Key or Region not configured. Please set environment variables or update config."
    );
  }

  const speechConfig = sdk.SpeechConfig.fromSubscription(
    SPEECH_CONFIG.key,
    SPEECH_CONFIG.region
  );
  speechConfig.speechSynthesisLanguage =
    language || SPEECH_CONFIG.defaultSynthesisLanguage;
  speechConfig.speechSynthesisVoiceName =
    voiceName || SPEECH_CONFIG.defaultSynthesisVoice;
  speechConfig.speechSynthesisOutputFormat =
    sdk.SpeechSynthesisOutputFormat.Audio24Khz160KBitRateMonoMp3; // 修正大小写

  const finalFilename = `${outputFilename || uuidv4()}.mp3`;
  const audioFilePath = path.join(APP_CONFIG.file.downloadsDir, finalFilename);

  // 使用 AudioConfig.fromAudioFileOutput 输出到文件
  const audioConfig = sdk.AudioConfig.fromAudioFileOutput(audioFilePath);

  const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);

  return new Promise((resolve, reject) => {
    synthesizer.speakTextAsync(
      text,
      (result) => {
        synthesizer.close();
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          resolve(audioFilePath);
        } else {
          // 使用通用的 CancellationDetails
          const cancellation = sdk.CancellationDetails.fromResult(result);
          reject(
            new Error(
              `SYNTHESIS CANCELED: Reason=${cancellation.reason}. ErrorCode=${cancellation.ErrorCode}. ErrorDetails=${cancellation.errorDetails}`
            )
          );
        }
      },
      (err) => {
        synthesizer.close();
        reject(new Error(`Synthesis failed: ${err}`));
      }
    );
  });
}
