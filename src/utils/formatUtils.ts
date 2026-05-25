export const stripDongHoSuffix = (value: string): string =>
  value.trim().replace(/\s+/g, "").replace(/(동|호)$/, "");

export const formatDong = (value?: string): string => {
  const stripped = stripDongHoSuffix(value || "");
  return stripped ? `${stripped}동` : "";
};

export const formatRoomHo = (value?: string): string => {
  const stripped = stripDongHoSuffix(value || "");
  return stripped ? `${stripped}호` : "";
};