import type { Agent } from "./types";

/* BOARD-ONLY palette quarantine (UNSLOPIFY.md rule 4): callsign colors below
 * are kanban chrome, not product tokens — see the quarantine note in
 * ./types.ts. Never import this palette into product components. */

export const CALLSIGNS: Agent[] = [
  { id: "ghost", callsign: "GHOST", color: "#111214", glyph: "◈" },
  { id: "viper", callsign: "VIPER", color: "#0e7a3a", glyph: "⬢" },
  { id: "phantom", callsign: "PHANTOM", color: "#7c3aed", glyph: "⬣" },
  { id: "nova", callsign: "NOVA", color: "#ea580c", glyph: "✦" },
  { id: "axiom", callsign: "AXIOM", color: "#2563eb", glyph: "⬔" },
  { id: "blade", callsign: "BLADE", color: "#dc2626", glyph: "⬥" },
  { id: "cipher", callsign: "CIPHER", color: "#0891b2", glyph: "⬓" },
  { id: "orion", callsign: "ORION", color: "#1a1a1a", glyph: "◎" },
  { id: "vector", callsign: "VECTOR", color: "#374151", glyph: "⬡" },
  { id: "spectre", callsign: "SPECTRE", color: "#6b7280", glyph: "⬢" },
  { id: "neon", callsign: "NEON", color: "#c026d3", glyph: "⬣" },
  { id: "raven", callsign: "RAVEN", color: "#0f172a", glyph: "⬔" },
  { id: "falcon", callsign: "FALCON", color: "#1e40af", glyph: "⬥" },
  { id: "wraith", callsign: "WRAITH", color: "#334155", glyph: "⬓" },
  { id: "kite", callsign: "KITE", color: "#065f46", glyph: "◈" },
  { id: "hawk", callsign: "HAWK", color: "#92400e", glyph: "◎" },
  { id: "sable", callsign: "SABLE", color: "#422006", glyph: "⬡" },
  { id: "echo", callsign: "ECHO", color: "#0c4a6e", glyph: "✦" },
  { id: "frost", callsign: "FROST", color: "#164e63", glyph: "⬢" },
  { id: "jet", callsign: "JET", color: "#18181b", glyph: "⬣" },
  { id: "lynx", callsign: "LYNX", color: "#4c1d95", glyph: "⬔" },
  { id: "mantis", callsign: "MANTIS", color: "#14532d", glyph: "⬥" },
  { id: "vertex", callsign: "VERTEX", color: "#7f1d1d", glyph: "⬓" },
  { id: "quark", callsign: "QUARK", color: "#312e81", glyph: "◎" },
];

export const AGENT_BY_ID = Object.fromEntries(CALLSIGNS.map((a) => [a.id, a]));
export const AGENT_BY_CALLSIGN = Object.fromEntries(CALLSIGNS.map((a) => [a.callsign, a]));
