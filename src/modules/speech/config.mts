/**
 * Azure Speech Service Configuration
 */
export const SPEECH_CONFIG = {
  key: process.env.AZURE_SPEECH_KEY || "YOUR_AZURE_SPEECH_KEY", // 强烈建议从环境变量读取
  region: process.env.AZURE_SPEECH_REGION || "YOUR_AZURE_SPEECH_REGION", // 强烈建议从环境变量读取
  defaultRecognitionLanguage: "en-US", // 默认识别语言
  defaultSynthesisLanguage: "en-US", // 默认合成语言
  defaultSynthesisVoice: "en-US-AvaMultilingualNeural", // 默认合成语音
};

if (
  SPEECH_CONFIG.key === "YOUR_AZURE_SPEECH_KEY" ||
  SPEECH_CONFIG.region === "YOUR_AZURE_SPEECH_REGION"
) {
  console.warn(
    "Azure Speech Key or Region not configured. Please set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION environment variables or update src/modules/speech/config.mts."
  );
}
