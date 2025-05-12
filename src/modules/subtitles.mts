import * as fs from "fs";
import { _spawnPromise } from "./utils.js";
import { CONFIG as APP_CONFIG } from "../config.js";

/**
 * Embeds subtitles from an SRT file into a video file using FFmpeg.
 *
 * @param inputVideoPath - Full path to the input video file.
 * @param srtPath - Full path to the SRT subtitle file.
 * @param outputVideoPath - Full path for the output video file with embedded subtitles.
 * @param styleOptions - Optional FFmpeg style string for subtitles (e.g., "force_style='FontName=Arial,FontSize=16'").
 *                       Defaults to a basic bottom-center alignment.
 * @throws If FFmpeg command fails.
 */
export async function embedSubtitles(
  inputVideoPath: string,
  srtPath: string,
  outputVideoPath: string,
  // 参考：https://ffmpeg.org/ffmpeg-filters.html#subtitles-1
  // 简单的样式，避免复杂转义。用户可以通过 execute_ffmpeg_command 自定义复杂样式。
  styleOptions: string = "force_style='Alignment=10'" // ASS alignment: 10 for bottom center
): Promise<void> {
  const downloadsDir = APP_CONFIG.file.downloadsDir; // Assuming ffmpeg runs relative to this dir or uses absolute paths

  // Ensure srtPath is properly escaped for the FFmpeg filter graph
  // FFmpeg filter syntax requires escaping special characters like \ and :
  // Inside JS strings, \ needs to be escaped itself, so \ becomes \\, and \: becomes \\:
  const escapedSrtPathForFilter = srtPath
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:");

  const ffmpegArgs = [
    "-i",
    inputVideoPath, // Input video
    "-vf",
    // Correct syntax: filename='escaped_path':force_style='...'
    `subtitles=filename='${escapedSrtPathForFilter}':${styleOptions}`,
    "-c:a",
    "copy", // Copy audio stream without re-encoding
    "-c:v",
    "libx264", // Re-encode video to embed subtitles
    "-crf",
    "23", // Constant Rate Factor (quality, lower is better, 18-28 is typical)
    "-preset",
    "fast", // Encoding speed preset (faster encoding, larger file)
    outputVideoPath, // Output video
    "-y", // Overwrite output file if it exists
  ];

  console.log(
    `Embedding subtitles: ffmpeg ${ffmpegArgs.join(" ")} in ${downloadsDir}`
  );

  try {
    // Execute FFmpeg command. Using downloadsDir as CWD might simplify relative paths if needed,
    // but absolute paths in args should work fine.
    await _spawnPromise("ffmpeg", ffmpegArgs, { cwd: downloadsDir });
    console.log(`Successfully embedded subtitles into ${outputVideoPath}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`FFmpeg subtitle embedding failed: ${errorMessage}`);
    // Attempt to clean up potentially incomplete output file
    if (fs.existsSync(outputVideoPath)) {
      try {
        await fs.promises.unlink(outputVideoPath);
      } catch (cleanupError) {
        console.error(
          `Failed to cleanup output video file ${outputVideoPath}: ${cleanupError}`
        );
      }
    }
    throw new Error(
      `FFmpeg subtitle embedding failed for ${inputVideoPath}. Error: ${errorMessage}`
    );
  }
}
