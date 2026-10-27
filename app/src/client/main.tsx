import { createRoot } from 'react-dom/client';
import { App } from './App';
// fonts ship with the app: a page must never wait on a font server (Google Fonts kept resetting from Kenya)
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/public-sans/400.css';
import '@fontsource/public-sans/600.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// installable app: register the service worker (public/sw.js)
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
