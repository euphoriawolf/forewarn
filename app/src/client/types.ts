// Shapes shared by the screens. They match what /api/place returns (src/server).
export interface Place { name: string; where: string; lat: number; lon: number }
export type Level = 'green' | 'amber' | 'red';
export interface Day { day: string; weekday: string; runs: number; runsOverLine: number; middleMm: number; wettestMm: number; level: Level; chance: string }
export interface FloodLine {
  mm: number; source: 'last-flood' | 'heavy-rain'; note: string;
  lastFlood?: { event: string; region: string; peakCm: number; peakTime: string | null; firstWet: string | null; river: boolean };
}
export interface Answer { floodLine: FloodLine; forecast: { days: Day[]; worst: Day; squares: { lat: number; lon: number; weight: number }[]; issued: string }; error?: string }
