const SECTION_COLORS = {
  health: "#0f6b63",
  science: "#1a4a8a",
  policy: "#5a2d82",
  politics: "#5a2d82",
  economy: "#8a4a0a",
  technology: "#0a5a8a",
  environment: "#2a6a2a",
  law: "#8a1a1a",
  default: "#c9243f",
};

export function getSectionColor(section) {
  return SECTION_COLORS[String(section || "").toLowerCase()] || SECTION_COLORS.default;
}

export function getSectionColorHex(section) {
  return getSectionColor(section);
}
