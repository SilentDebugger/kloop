import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { colors } from "@kloop/shared";

/**
 * Tiny native markdown renderer: paragraphs, ordered/unordered lists
 * (numbered circles like the mockups), headings, `code`, **bold**.
 */
export function MarkdownLite({ text, size = 15 }: { text: string; size?: number }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let key = 0;
  let listIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line) {
      listIndex = 0;
      continue;
    }

    const ol = line.match(/^\d+[.)]\s+(.*)/);
    const ul = line.match(/^[-*]\s+(.*)/);
    if (ol || ul) {
      listIndex += 1;
      out.push(
        <View key={key++} style={{ flexDirection: "row", gap: 10, marginVertical: 4, alignItems: "flex-start" }}>
          {ol ? (
            <Text style={{ color: colors.primary, fontWeight: "700", fontSize: size - 1, width: 16, textAlign: "center" }}>{listIndex}</Text>
          ) : (
            <Text style={{ color: colors.primary, fontWeight: "700", fontSize: size, width: 16, textAlign: "center" }}>·</Text>
          )}
          <Text style={{ flex: 1, fontSize: size, lineHeight: size * 1.45, color: colors.text }}>{inline((ol ?? ul)![1] ?? "", size)}</Text>
        </View>,
      );
      continue;
    }
    listIndex = 0;

    const h = line.match(/^#{1,3}\s+(.*)/);
    if (h) {
      out.push(
        <Text key={key++} style={{ fontSize: size + 2, fontWeight: "700", color: colors.text, marginTop: 8, marginBottom: 2 }}>
          {inline(h[1] ?? "", size + 2)}
        </Text>,
      );
      continue;
    }

    out.push(
      <Text key={key++} style={{ fontSize: size, lineHeight: size * 1.5, color: colors.text, marginVertical: 3 }}>
        {inline(line, size)}
      </Text>,
    );
  }

  return <View>{out}</View>;
}

function inline(s: string, size: number): ReactNode[] {
  // split on **bold** and `code`
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <Text key={i} style={{ fontWeight: "700" }}>
          {p.slice(2, -2)}
        </Text>
      );
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <Text key={i} style={{ fontFamily: "Courier", fontSize: size - 2, backgroundColor: colors.chip }}>
          {p.slice(1, -1)}
        </Text>
      );
    }
    return <Text key={i}>{p}</Text>;
  });
}
