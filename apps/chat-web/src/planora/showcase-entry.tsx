import { createRoot } from 'react-dom/client';
import { PlanoraShowcase } from './samples/PlanoraShowcase';
import '../index.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<PlanoraShowcase />);
}
