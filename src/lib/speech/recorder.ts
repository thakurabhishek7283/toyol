// Microphone recording. The microphone is opened when listening starts and
// released when it stops; audio stays in memory, transcribed as it comes in
// (lib/speech/live.ts) or once it stops.

import { SAMPLE_RATE } from './audio';

// A question is rarely longer; past this, recording stops on its own
export const MAX_RECORDING_SECONDS = 120;
const FRAME_SIZE = 2048;

interface Recording {
  stream: MediaStream;
  context: AudioContext;
  // Room for the longest recording, filled as it goes, so the recording so
  // far can be read (recordedAudio) without copying it
  samples: Float32Array;
  length: number;
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
  const current: Recording = { stream, context, samples: new Float32Array(MAX_RECORDING_SECONDS * SAMPLE_RATE), length: 0 };
  processor.onaudioprocess = (e) => {
    const frame = e.inputBuffer.getChannelData(0);
    if (current.length + frame.length > current.samples.length) {
      onLimit();
      return;
    }
    current.samples.set(frame, current.length);
    current.length += frame.length;
    let sum = 0;
    for (const x of frame) sum += x * x;
    // RMS on a rough log scale: -60 dB at the bottom of the meter, 0 dB at the top
    const db = 20 * Math.log10(Math.sqrt(sum / frame.length) + 1e-9);
    onLevel(Math.max(0, Math.min(1, (db + 60) / 60)));
  };
  source.connect(processor);
  processor.connect(context.destination); // a processor only runs while connected
  recording = current;
}

/** The recording so far (a view: it isn't copied), or null if not recording */
export function recordedAudio(): Float32Array | null {
  return recording ? recording.samples.subarray(0, recording.length) : null;
}

/** Stop and release the microphone. The samples, or null if not recording. */
export async function stopRecording(): Promise<Float32Array | null> {
  const current = recording;
  if (!current) return null;
  recording = null;
  current.stream.getTracks().forEach((track) => track.stop());
  await current.context.close();
  return current.samples.subarray(0, current.length);
}

export const isRecording = () => recording !== null;

/** The microphones, for Settings (names show once the mic has been used) */
export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
}
