import { spawn } from "node:child_process";
import { env } from "../../env";

// whisper-rocm's API (whisper.cpp under the hood) expects WAV; WhatsApp voice
// notes arrive as OGG/Opus. Transcode via ffmpeg (already on this machine)
// entirely in-memory, no temp files.
function oggToWav(oggBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", "pipe:0",
      "-ar", "16000",
      "-ac", "1",
      "-f", "wav",
      "pipe:1",
    ]);

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errChunks).toString().slice(-500)}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    ffmpeg.stdin.write(oggBuffer);
    ffmpeg.stdin.end();
  });
}

// Best-effort — any failure here (ffmpeg missing, whisper down, bad audio)
// degrades to no transcript, never breaks ingestion.
export async function transcribeAudio(oggBuffer: Buffer): Promise<string | null> {
  try {
    const wavBuffer = await oggToWav(oggBuffer);

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([Uint8Array.from(wavBuffer)], { type: "audio/wav" }),
      "audio.wav"
    );
    formData.append("language", "pt");
    formData.append("response_format", "text");

    const res = await fetch(`${env.WHISPER_API_URL}/v1/audio/transcriptions`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      console.error(`[transcribe] whisper API respondeu ${res.status}`);
      return null;
    }

    const text = (await res.text()).trim();
    return text || null;
  } catch (error) {
    console.error("[transcribe] falha ao transcrever áudio", error);
    return null;
  }
}
