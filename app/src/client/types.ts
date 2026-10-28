// Shapes shared by the screens. They match what /api/place returns (src/server).
export interface Place { name: string; where: string; lat: number; lon: number }
// the place's name on a map tag, short enough to fit
export const pinLabel = (name: string) => (name.length > 26 ? `${name.slice(0, 25).trimEnd()}…` : name);
export type Level = 'green' | 'amber' | 'red';
export interface Day { day: string; weekday: string; when: string; runs: number; runsOverLine: number; middleMm: number; wettestMm: number; level: Level; chance: string }
export interface FloodLine {
  mm: number; source: 'last-flood' | 'heavy-rain'; note: string;
  lastFlood?: { event: string; region: string; peakCm: number; peakTime: string | null; firstWet: string | null; river: boolean };
}
export interface Nearby { distanceM: number; direction: string; peakCm: number; peakTime: string; here: boolean; x: number; z: number }
export interface Week { start: string; aboveNormalPct: number; meanMm: number; word: string }
export interface Answer { outlook?: Week[]; logging?: boolean; nearby?: Nearby | null; pack: { region: string; tiles: [number, number][]; cx: number; cz: number; dx: number; dz: number; start: string } | null; floodLine: FloodLine; forecast: { days: Day[]; worst: Day; squares: { lat: number; lon: number; weight: number }[]; issued: string }; error?: string }
