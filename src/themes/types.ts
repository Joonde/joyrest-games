export type ThemeKind = "brand" | "seasonal" | "occasion";
export type AgeRating = "0+" | "12+" | "18+";

export interface ThemeTokens {
  colors: {
    bg: string;
    surface: string;
    surfaceAlt: string;
    text: string;
    textMuted: string;
    primary: string;
    primaryText: string;
    accent: string;
    danger: string;
    success: string;
    focus: string;
    border: string;
  };
  fonts: { body: string; display: string };
  radius: { sm: string; md: string; lg: string };
  background: string;
}

export interface Theme {
  id: string;
  title: string;
  kind: ThemeKind;
  tokens: ThemeTokens;
  sounds: Record<string, string>;
  ageRating: AgeRating;
}
