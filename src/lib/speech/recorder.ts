// Microphone recording. The microphone is opened when listening starts and
// released when it stops; audio stays in memory until it's transcribed.

import { SAMPLE_RATE } from './audio';

// A question is rarely longer; past this, recording stops on its own
export const MAX_RECORDING_SECONDS = 120;
const FRAME_SIZE = 2048;

interface Recording {
  stream: MediaStream;
  context: AudioContext;
  frames: Float32Array[];
}

let recording: Recording | null = null;

/**
 * Start recording. `onLevel` gets the input level (0-1) about 8 times a second,
 * for the meter; `onLimit` is called if the recording reaches its maximum length.
 */
export async function startRecording(micId: string, onLevel: (level: number) => void, onLimit: () => void): Promise<void> {
  if (recording) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: micId ? { exact: micId } : undefined,
      channelCount: 1,
      // Chromium's own clean-up: steadies the level of a quiet or distant
      // mic and takes out steady background noise (fans), which Whisper
      // otherwise sometimes turns into words
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  // The context resamples the microphone to the model's rate
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessorNode is deprecated, but an AudioWorklet would need its own
  // module file for what is a copy of each frame
  const processor = context.createScriptProcessor(FRAME_SIZE, 1, 1);
  const frames: Float32Array[] = [];
  const maxFrames = Math.ceil((MAX_RECORDING_SECONDS * SAMPLE_RATE) / FRAME_SIZE);
  processor.onaudioprocess = (e) => {
    const frame = new Float32Array(e.inputBuffer.getChannelData(0));
    if (frames.length >= maxFrames) {
      onLimit();
      return;
    }
    frames.push(frame);
    let sum = 0;
    for (const x of frame) sum += x * x;
    // RMS on a rough log scale: -60 dB at the bottom of the meter, 0 dB at the top
    const db = 20 * Math.log10(Math.sqrt(sum / frame.length) + 1e-9);
    onLevel(Math.max(0, Math.min(1, (db + 60) / 60)));
  };
  source.connect(processor);
  processor.connect(context.destination); // a processor only runs while connected
  recording = { stream, context, frames };
}

/** Stop and release the microphone. The samples, or null if not recording. */
export async function stopRecording(): Promise<Float32Array | null> {
  const current = recording;
  if (!current) return null;
  recording = null;
  current.stream.getTracks().forEach((track) => track.stop());
  await current.context.close();

  const audio = new Float32Array(current.frames.reduce((n, f) => n + f.length, 0));
  let offset = 0;
  for (const frame of current.frames) {
    audio.set(frame, offset);
    offset += frame.length;
  }
  return audio;
}

export const isRecording = () => recording !== null;

/** The microphones, for Settings (names show once the mic has been used) */
export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
}
