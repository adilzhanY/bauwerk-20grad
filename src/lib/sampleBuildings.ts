import type { MessageKey } from "@/i18n";

/** Buildings with a sample photo, offered while the search box is empty. */
export const SAMPLE_BUILDINGS: { gid: string; street: string; note: MessageKey }[] = [
  { gid: "DEBE02YY40000BOo", street: "Methfesselstraße 8", note: "start.example.red" },
  { gid: "DEBE02YY40000Atr", street: "Methfesselstraße 6", note: "start.example.yellow" },
  { gid: "DEBE02YY400001Vh", street: "Methfesselstraße 4", note: "start.example.pub" },
  { gid: "DEBE02YY400000kY", street: "Methfesselstraße 27", note: "start.example.corner" },
];
