const WIDE_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff01-\uff60\uffe0-\uffe6\p{Extended_Pictographic}]/u;

/** 曲名を「全角12文字 / 半角20文字」相当の幅に収める。 */
export function truncateSongTitle(title: string): string {
  const maxWidth = 240;
  let width = 0;
  let output = "";
  for (const character of title.replace(/[|\r\n]/g, " ")) {
    const characterWidth = WIDE_CHARACTER.test(character) ? 20 : 12;
    if (width + characterWidth > maxWidth) break;
    output += character;
    width += characterWidth;
  }
  return output;
}
