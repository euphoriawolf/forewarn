// The few icons the screens use, drawn inline so nothing loads from elsewhere.
const s = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const Logo = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2.2}><path d="M3 18c2 0 2-1.5 4.5-1.5S10 18 12 18s2-1.5 4.5-1.5S19 18 21 18" /><path d="M12 3v9M8.5 8.5L12 12l3.5-3.5" /></svg>;
export const Search = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>;
export const Locate = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2}><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>;
export const Drop = () => <svg viewBox="0 0 13 16"><path d="M6.5 1C4 5 1.5 7.6 1.5 10.3a5 5 0 0 0 10 0C11.5 7.6 9 5 6.5 1z" fill="currentColor" /></svg>;
export const Ok = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2.4}><circle cx="12" cy="12" r="10" /><path d="M7.5 12.5l3 3 6-6.5" /></svg>;
export const Warn = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2.4}><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.2" /></svg>;
export const Tick = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={3}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
export const Send = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2.2}><path d="M5 12h13M13 6l6 6-6 6" /></svg>;
export const Sun = () => <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" fill="currentColor" /></svg>;
export const Rain = () => <svg viewBox="0 0 24 24"><path d="M7 13h9.5a3.5 3.5 0 0 0 .3-7A5 5 0 0 0 7.3 7.5 3 3 0 0 0 7 13z" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M9 16l-1 2.5M13 16l-1 2.5M17 16l-1 2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
export const Storm = () => <svg viewBox="0 0 24 24"><path d="M7 12h9.5a3.5 3.5 0 0 0 .3-7A5 5 0 0 0 7.3 6.5 3 3 0 0 0 7 12z" fill="currentColor" /><path d="M8 15l-1.5 4M12 15l-1.5 4M16 15l-1.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
export const Papers = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2}><path d="M6 3h9l4 4v14H6z" /><path d="M12 17V10M9 13l3-3 3 3" /></svg>;
export const Route = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2}><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h6a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h6" /></svg>;
export const Car = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2}><path d="M5 16h14v-4l-2-5H7l-2 5z" /><circle cx="8" cy="16" r="1.5" /><circle cx="16" cy="16" r="1.5" /></svg>;
export const Bell = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2}><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 21h4" /></svg>;
export const Play = () => <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>;
export const Eye = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2.2}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
export const Up = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2.2}><path d="M4 18l8-12 8 12z" /></svg>;
export const Plus = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2.4}><path d="M12 5v14M5 12h14" /></svg>;
export const Minus = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2.4}><path d="M5 12h14" /></svg>;
// a compass needle: the red half points north
export const North = () => <svg viewBox="0 0 24 24"><path d="M12 3l4 9h-8z" fill="#b42318" /><path d="M12 21l-4-9h8z" fill="#9aa59f" /></svg>;
export const Camera = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2.1}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>;
export const Shield = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2}><path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z" /><path d="M9 12l2 2 4-4" /></svg>;
export const History = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></svg>;
export const Blur = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2}><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" /><path d="M3 3l18 18" /></svg>;
export const Flag = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2}><path d="M5 21V4h11l-2 4 2 4H5" /></svg>;
export const Mic = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2.2}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>;
export const Stop = () => <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" /></svg>;
export const Speaker = () => <svg viewBox="0 0 24 24" {...s} strokeWidth={2.1}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></svg>;
