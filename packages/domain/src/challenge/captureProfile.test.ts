import { describe, it, expect } from 'vitest';
import { getCaptureProfile } from './captureProfile.js';

describe('CaptureProfile', () => {
  it('returns coding profile for coding domain', () => {
    const profile = getCaptureProfile('coding');
    expect(profile.domain).toBe('coding');
    expect(profile.quickSignals).toContain('STUCK');
  });

  it('returns study profile for study_learning', () => {
    const profile = getCaptureProfile('study_learning');
    expect(profile.domain).toBe('study_learning');
    expect(profile.quickSignals).toContain('CONFUSED');
  });

  it('returns writing profile for writing_creative', () => {
    const profile = getCaptureProfile('writing_creative');
    expect(profile.domain).toBe('writing_creative');
    expect(profile.quickSignals).toContain('NEW IDEA');
  });

  it('returns physical profile for physical_task', () => {
    const profile = getCaptureProfile('physical_task');
    expect(profile.domain).toBe('physical_task');
    expect(profile.primaryInput).toBe('signal');
  });

  it('defaults to general for unknown domains', () => {
    const profile = getCaptureProfile('unknown_domain_XYZ');
    expect(profile.domain).toBe('general');
    expect(profile.quickSignals).toContain('CHANGING APPROACH');
  });

  it('defaults to general if domain is null', () => {
    const profile = getCaptureProfile(null);
    expect(profile.domain).toBe('general');
  });
});
