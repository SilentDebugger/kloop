import { useState } from "react";
import { fetch } from "expo/fetch";
import { File } from "expo-file-system";
import { activeWorkspace } from "./store/connection";
import { useVoiceNote } from "./recorder";
import type { LocalAttachment } from "./ui/attachments";

export type Picked = { uri: string; name: string; type: string };

/**
 * Multipart upload via Expo's WinterCG fetch. The old RN-style
 * `{ uri, name, type }` FormData part is not supported by Expo's FormData
 * ("Unsupported FormDataPart implementation") — the documented pattern is to
 * wrap the local URI in an expo-file-system File, which implements the Blob
 * interface and carries name + MIME type.
 */
export async function uploadFile(file: Picked): Promise<{ id: string; filename: string; kind: string }> {
  const ws = activeWorkspace();
  if (!ws?.token) throw new Error("not signed in");
  const form = new FormData();
  form.append("file", new File(file.uri) as unknown as Blob, file.name);
  const res = await fetch(`${ws.origin}/api/attachments`, {
    method: "POST",
    headers: { authorization: `Bearer ${ws.token}`, "x-kloop-org": ws.slug },
    body: form,
  });
  const data = (await res.json()) as { attachment?: { id: string; filename: string; kind: string }; error?: string };
  if (!res.ok || !data.attachment) throw new Error(data.error ?? "upload failed");
  return data.attachment;
}

/**
 * Camera / photo-library / voice-note capture + upload, with the pending list
 * kept for previews. One hook shared by every composer that takes attachments
 * (home one-box, chat reply, new-request sheet, search, article editor).
 */
export function useComposerAttachments() {
  const voice = useVoiceNote();
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attach = async (kind: "camera" | "photo" | "voice") => {
    setError(null);
    try {
      if (kind === "voice") {
        if (voice.recording) {
          const note = await voice.stop();
          if (note) {
            setUploading(true);
            const a = await uploadFile(note);
            setAttachments((x) => [...x, { id: a.id, filename: a.filename, kind: "audio", localUri: note.uri, durationMs: note.durationMs }]);
          }
        } else {
          await voice.start();
        }
        return;
      }
      const picked = await pickImage(kind === "camera");
      if (picked) {
        setUploading(true);
        const a = await uploadFile(picked);
        setAttachments((x) => [...x, { id: a.id, filename: a.filename, kind: a.kind, localUri: picked.uri }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed — try again.");
    } finally {
      setUploading(false);
    }
  };

  return {
    attachments,
    ids: attachments.map((a) => a.id),
    uploading,
    error,
    dismissError: () => setError(null),
    recording: voice.recording,
    attach,
    remove: (id: string) => setAttachments((x) => x.filter((y) => y.id !== id)),
    clear: () => setAttachments([]),
  };
}

export async function pickImage(fromCamera: boolean): Promise<Picked | null> {
  const ImagePicker = await import("expo-image-picker");
  if (fromCamera) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
  }
  const result = fromCamera
    ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 })
    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
  const asset = result.assets?.[0];
  if (result.canceled || !asset) return null;
  return {
    uri: asset.uri,
    name: asset.fileName ?? `photo-${Date.now()}.jpg`,
    type: asset.mimeType ?? "image/jpeg",
  };
}
