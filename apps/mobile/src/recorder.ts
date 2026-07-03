import { useState } from "react";
import { AudioModule, RecordingPresets, useAudioRecorder } from "expo-audio";
import type { Picked } from "./uploads";

/** Voice-note recorder for the composer and resolution capture. */
export function useVoiceNote() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);

  const start = async (): Promise<boolean> => {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) return false;
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
    return true;
  };

  const stop = async (): Promise<Picked | null> => {
    setRecording(false);
    try {
      await recorder.stop();
    } catch {
      return null;
    }
    const uri = recorder.uri;
    if (!uri) return null;
    const ext = uri.split(".").pop() ?? "m4a";
    return { uri, name: `voice-note.${ext}`, type: ext === "webm" ? "audio/webm" : "audio/m4a" };
  };

  return { recording, start, stop };
}
