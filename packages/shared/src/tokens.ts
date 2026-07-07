/**
 * kloop design tokens — extracted from the design mockups.
 * Consumed by the web app (Tailwind v4 @theme) and the mobile app
 * (React Native StyleSheet) so both render the same language.
 */
export const colors = {
  /** warm off-white app background */
  background: "#F4F2EC",
  /** slightly lifted surfaces (inputs on cards, keyboard chips) */
  surface: "#FBFAF7",
  /** cards */
  card: "#FFFFFF",
  /** deep green primary (buttons, own message bubbles, links) */
  primary: "#2E7D5B",
  /** pressed / darker primary */
  primaryDark: "#25654A",
  /** deep forest hero block (requester home header) */
  forest: "#1E5B44",
  /** muted sage — disabled state on forest/primary surfaces */
  sage: "#A9C7B7",
  /** pale mint (status badge bg, precedents banner, confirm card) */
  mint: "#E3EEE7",
  /** deeper mint for icon tiles */
  mintStrong: "#CFE3D6",
  /** ink */
  text: "#1D1B16",
  /** secondary text */
  textSecondary: "#8A867C",
  /** faint text / placeholders */
  textFaint: "#B4B0A6",
  /** beige chip / secondary button background */
  chip: "#ECEAE2",
  /** borders and hairlines */
  border: "#E7E4DB",
  /** focused input border (green) */
  borderFocus: "#2E7D5B",
  /** internal note background */
  noteBg: "#FBF3DC",
  /** internal note label */
  noteLabel: "#A8842C",
  /** destructive / reject */
  danger: "#B4472F",
  /** danger soft background */
  dangerSoft: "#F7E9E4",
  /** open status dot */
  statusOpen: "#2E7D5B",
  /** solved badge text */
  statusSolved: "#2E7D5B",
  /** amber accent (stale docs) */
  amber: "#C29135",
  amberSoft: "#F6ECD4",
  /** white text on primary */
  onPrimary: "#FFFFFF",
} as const;

export const radii = {
  /** cards */
  lg: 20,
  /** inner cards, inputs */
  md: 14,
  /** chips, pills, buttons */
  pill: 999,
  /** message bubbles */
  bubble: 18,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const font = {
  /** system stack keeps it feeling native on every platform */
  family:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  /** page titles ("What's not working?", "Queue") */
  title: 28,
  /** card titles */
  heading: 17,
  body: 15,
  small: 13,
  /** uppercase section labels */
  label: 11,
} as const;

export type StatusKind = "open" | "handled" | "solved";

export const statusLabels: Record<StatusKind, string> = {
  open: "Open",
  handled: "Being handled",
  solved: "Solved",
};
