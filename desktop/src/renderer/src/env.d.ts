import type { ScwApi } from '../../shared/types';

declare global {
  interface Window {
    scw: ScwApi;
  }
}

