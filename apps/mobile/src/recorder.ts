import { useState } from "react";
import { AudioModule, RecordingPresets, useAudioRecorder } from "expo-audio";
import { haptics } from "./haptics";
import type { Picked } from "./uploads";

/** Voice-note recorder for the composer and resolution capture. */
export function useVoiceNote() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);

  const start = async (): Promise<boolean> => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return false;
      // iOS throws RecordingDisabledException unless the audio session
      // explicitly allows recording first.
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      // confirms the recording actually started, not just the button press
      haptics.medium();
      return true;
    } catch {
      setRecording(false);
      return false;
    }
  };

  const stop = async (): Promise<(Picked & { durationMs: number }) | null> => {
    setRecording(false);
    let uri: string | null = null;
    let durationMs = 0;
    try {
      durationMs = Math.max(0, Math.round((recorder.currentTime ?? 0) * 1000));
      await recorder.stop();
      uri = recorder.uri;
    } catch {
      uri = null;
    }
    // back to playback-only so audio routes to the speaker again;
    // keep playsInSilentMode or previews stay silent with the mute switch on
    void AudioModule.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    if (!uri) return null;
    const ext = uri.split(".").pop() ?? "m4a";
    return { uri, name: `voice-note.${ext}`, type: ext === "webm" ? "audio/webm" : "audio/m4a", durationMs };
  };

  return { recording, start, stop };
}
