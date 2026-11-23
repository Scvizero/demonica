export type RGB = [number, number, number];

/** [тінь, середина, жар, ядро] — кольори в sRGB, як на моніторі */
export const PALETTES: Record<string, RGB[]> = {
  "пекельний (як на фото)": [
    [0.28, 0.0, 0.0],
    [0.75, 0.05, 0.02],
    [1.0, 0.36, 0.04],
    [1.0, 0.72, 0.25],
  ],
  "класичний помаранчевий": [
    [0.35, 0.05, 0.0],
    [0.9, 0.25, 0.02],
    [1.0, 0.6, 0.1],
    [1.0, 0.93, 0.6],
  ],
  "демонічний фіолетовий": [
    [0.15, 0.0, 0.2],
    [0.5, 0.05, 0.7],
    [0.85, 0.3, 1.0],
    [1.0, 0.85, 1.0],
  ],
  синій: [
    [0.0, 0.03, 0.25],
    [0.05, 0.25, 0.9],
    [0.3, 0.65, 1.0],
    [0.85, 0.95, 1.0],
  ],
  зелений: [
    [0.0, 0.15, 0.02],
    [0.1, 0.6, 0.05],
    [0.5, 1.0, 0.2],
    [0.9, 1.0, 0.7],
  ],
};

export const LIGHT_COLORS: Record<string, number> = {
  "пекельний (як на фото)": 0xff4a14,
  "класичний помаранчевий": 0xff7a22,
  "демонічний фіолетовий": 0x9a3cff,
  синій: 0x3a7bff,
  зелений: 0x5cff3a,
};

export interface FireOrbParams {
  palette: string;
  /** радіус кулі, м */
  radius: number;
  /** висота центру кулі над якорем (долонею), м */
  offsetY: number;
  intensity: number;
  turbulence: number;
  /** наскільки далеко язики виходять за кулю */
  flameHeight: number;
  /** різкість тонких ниток */
  sharpness: number;
  /** слабке свічення всередині кулі */
  core: number;
  speed: number;
  bloom: number;
  exposure: number;
  /** сила світла на персонажі */
  light: number;
  sparks: boolean;
  sparkCount: number;
  sparkSize: number;
  sparkShape: "soft" | "diamond" | "streak";
}

export interface FireWallParams {
  enabled: boolean;
  palette: string;
  width: number;
  height: number;
  distance: number;
  intensity: number;
  turbulence: number;
  flameHeight: number;
  speed: number;
}

export const DEFAULT_PARAMS: FireOrbParams = {
  palette: "пекельний (як на фото)",
  radius: 0.17,
  offsetY: 0.22,
  intensity: 1.0,
  turbulence: 0.7,
  flameHeight: 1.0,
  sharpness: 3.5,
  core: 0.12,
  speed: 1.0,
  bloom: 0.85,
  exposure: 1.0,
  light: 1.0,
  sparks: true,
  sparkCount: 90,
  sparkSize: 1.0,
  sparkShape: "soft",
};

export const DEFAULT_WALL_PARAMS: FireWallParams = {
  enabled: true,
  palette: 'класичний помаранчевий',
  width: 4.8,
  height: 3.4,
  distance: 1.45,
  intensity: 0.7,
  turbulence: 0.9,
  flameHeight: 1.0,
  speed: 0.8,
};
