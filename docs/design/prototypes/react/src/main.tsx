import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import themeCss from '../../theme.css?raw';
import './app/theme';
import './styles/tailwind.css';
import { App } from './App';

// theme.css của bản mẫu dùng chung cho mọi trang, đứng trước CSS riêng của trang và Tailwind như trong bản mẫu.
const theme = document.createElement('style');
theme.dataset.protoTheme = '';
theme.textContent = themeCss;
document.head.insertBefore(theme, document.querySelector('meta[name="proto-css-anchor"]'));

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
