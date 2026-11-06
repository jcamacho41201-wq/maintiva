const gsmBasic = new Set(Array.from("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"));
const gsmExtended = new Set(Array.from("\f^{}\\[~]|€"));

export function smsLength(message: string) {
  const gsm = Array.from(message).every((character) => gsmBasic.has(character) || gsmExtended.has(character));
  const units = gsm ? Array.from(message).reduce((sum, character) => sum + (gsmExtended.has(character) ? 2 : 1), 0) : message.length;
  const single = gsm ? 160 : 70;
  const multipart = gsm ? 153 : 67;
  return { characters: Array.from(message).length, segments: units <= single ? 1 : Math.ceil(units / multipart), encoding: gsm ? "GSM-7" : "UCS-2" };
}
