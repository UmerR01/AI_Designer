export type LogoPreset = {
  id: number;
  name: string;
  platform: string;
  size: string;
  w: number;
  h: number;
  /** Marks small web favicon artboards */
  favicon?: boolean;
};

export const LOGO_PRESETS: LogoPreset[] = [
  { id: 1, name: "Instagram Profile", platform: "Instagram", size: "320 × 320 px", w: 320, h: 320 },
  { id: 2, name: "Facebook Profile", platform: "Facebook", size: "360 × 360 px", w: 360, h: 360 },
  { id: 3, name: "Logo Square (250 px)", platform: "Brand", size: "250 × 250 px", w: 250, h: 250 },
  { id: 4, name: "Logo Square (375 px)", platform: "Brand", size: "375 × 375 px", w: 375, h: 375 },
  { id: 5, name: "Logo Square (500 px)", platform: "Brand", size: "500 × 500 px", w: 500, h: 500 },
  { id: 6, name: "Favicon", platform: "Web", size: "32 × 32 px", w: 32, h: 32, favicon: true },
  { id: 7, name: "Favicon HD", platform: "Web", size: "48 × 48 px", w: 48, h: 48, favicon: true },
  { id: 8, name: "Apple Touch Icon", platform: "iOS", size: "180 × 180 px", w: 180, h: 180 },
  { id: 9, name: "App Store Icon", platform: "App", size: "1024 × 1024 px", w: 1024, h: 1024 },
  { id: 10, name: "LinkedIn Profile", platform: "LinkedIn", size: "400 × 400 px", w: 400, h: 400 },
  { id: 11, name: "X / Twitter Avatar", platform: "X", size: "400 × 400 px", w: 400, h: 400 },
  { id: 12, name: "YouTube Channel", platform: "YouTube", size: "800 × 800 px", w: 800, h: 800 },
];
