import { activeWorkspace } from "./store/connection";

export type Picked = { uri: string; name: string; type: string };

/**
 * RN-native multipart upload (FormData with file URIs — Blob isn't a thing
 * in React Native the way the web client expects).
 */
export async function uploadFile(file: Picked): Promise<{ id: string; filename: string; kind: string }> {
  const ws = activeWorkspace();
  if (!ws?.token) throw new Error("not signed in");
  const form = new FormData();
  // @ts-expect-error React Native FormData accepts {uri,name,type}
  form.append("file", { uri: file.uri, name: file.name, type: file.type });
  const res = await fetch(`${ws.origin}/api/attachments`, {
    method: "POST",
    headers: { authorization: `Bearer ${ws.token}`, "x-kloop-org": ws.slug },
    body: form,
  });
  const data = (await res.json()) as { attachment?: { id: string; filename: string; kind: string }; error?: string };
  if (!res.ok || !data.attachment) throw new Error(data.error ?? "upload failed");
  return data.attachment;
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
