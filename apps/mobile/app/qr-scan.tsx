import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { colors } from "@kloop/shared";
import { haptics } from "../src/haptics";
import { Button } from "../src/ui";

/** Scan the workspace QR (shown in the web admin's Integrations page). */
export default function QrScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const handled = useRef(false);

  if (!permission) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center", padding: 24, gap: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text, textAlign: "center" }}>Camera access needed</Text>
        <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: "center" }}>
          kloop uses the camera only to scan your workspace QR code.
        </Text>
        <Button title="Allow camera" onPress={() => void requestPermission()} />
        <Pressable onPress={() => router.back()}>
          <Text style={{ textAlign: "center", color: colors.textSecondary, fontWeight: "600" }}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current || locked) return;
          handled.current = true;
          setLocked(true);
          haptics.success();
          router.replace({ pathname: "/connect", params: { scanned: data } });
        }}
      />
      <SafeAreaView style={{ position: "absolute", top: 0, left: 0, right: 0, alignItems: "center" }}>
        <Text style={{ color: "#fff", fontWeight: "600", marginTop: 12, fontSize: 15 }}>Point at the workspace QR code</Text>
      </SafeAreaView>
      <SafeAreaView style={{ position: "absolute", bottom: 24, left: 0, right: 0, alignItems: "center" }}>
        <Pressable onPress={() => router.back()} style={{ backgroundColor: "rgba(255,255,255,0.9)", borderRadius: 999, paddingVertical: 10, paddingHorizontal: 24 }}>
          <Text style={{ fontWeight: "600", color: colors.text }}>Cancel</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}
