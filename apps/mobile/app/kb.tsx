import { KnowledgeBrowser } from "../src/screens/KnowledgeBrowser";

/** Standalone KB route (requesters, settings) — the supporter tab renders the same browser. */
export default function KbScreen() {
  return <KnowledgeBrowser showBack />;
}
