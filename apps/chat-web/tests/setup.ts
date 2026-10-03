import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
// jsdom has no viewport scrolling; browser QA covers actual scroll positions.
window.scrollTo = vi.fn();
