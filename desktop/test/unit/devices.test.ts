import { describe, expect, it } from 'vitest';
import { isMonitorAudio } from '../../src/renderer/src/session/devices';

describe('isMonitorAudio', () => {
  it('recognises monitor sound over HDMI / DisplayPort', () => {
    expect(isMonitorAudio('HP Z22i (2- HD Audio Driver for Display Audio)')).toBe(true);
    expect(isMonitorAudio('Default - DELL U2419H (Intel(R) Display Audio)')).toBe(true);
    expect(isMonitorAudio('LG HDR 4K (NVIDIA High Definition Audio) HDMI')).toBe(true);
  });
  it('leaves real speakers and headsets alone', () => {
    expect(isMonitorAudio('Speakers (Realtek(R) Audio)')).toBe(false);
    expect(isMonitorAudio('Headphones (Jabra Evolve2 65)')).toBe(false);
    expect(isMonitorAudio('Headset Earphone (HyperX Cloud)')).toBe(false);
  });
});
