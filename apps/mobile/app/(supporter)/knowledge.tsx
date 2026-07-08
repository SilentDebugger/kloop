import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link } from "expo-router";
import { colors } from "@kloop/shared";
import { haptics } from "../../src/haptics";
import { GlassSurface } from "../../src/ui";
import { KnowledgeBrowser } from "../../src/screens/KnowledgeBrowser";

/**
 * Supporter Knowledge tab: the KB browser plus a floating "New doc" pill that
 * morphs (native iOS zoom transition) into the capture screen — the same
 * effect as the home composer's Send button into a new request.
 */
export default function KnowledgeTab() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KnowledgeBrowser title="Knowledge" />

      {/* SafeAreaView applies the bottom inset (home indicator + native tab
          bar) natively on the first frame — no hardcoded offset, no jump */}
      <SafeAreaView
        edges={["bottom"]}
        pointerEvents="box-none"
        style={{ position: "absolute", left: 0, right: 0, bottom: 8, alignItems: "flex-end", paddingRight: 16 }}
      >
        <Link href="/new-doc" asChild>
          <Pressable onPress={() => haptics.tap()} style={({ pressed }) => ({ borderRadius: 999, opacity: pressed ? 0.9 : 1 })}>
            <GlassSurface
              interactive
              fallbackColor={colors.primary}
              tintColor={colors.primary}
              style={{
                height: 48,
                paddingHorizontal: 22,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                shadowColor: "#1D1B16",
                shadowOpacity: 0.18,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 5 },
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                <Text style={{ color: colors.onPrimary, fontSize: 15 }}>✦</Text>
                <Text style={{ color: colors.onPrimary, fontWeight: "700", fontSize: 15 }}>New doc</Text>
              </View>
            </GlassSurface>
            {/* Zoom source rect. Must be OUTSIDE the GlassSurface (the native
                glass view hides RN children from the detector) and must not
                wrap the label (the detector wrapper stops descendants from
                drawing) — so it's an invisible sibling with the pill's frame.
                collapsable={false}: the native zoom source holds a WEAK ref to
                this view; Fabric flattens empty Views away, which nils the ref
                and kills the transition ("No source view found"). */}
            <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
              <Link.AppleZoom>
                <View collapsable={false} style={{ flex: 1 }} />
              </Link.AppleZoom>
            </View>
          </Pressable>
        </Link>
      </SafeAreaView>
    </View>
  );
}
