// Shared types for RivalLens — mirrors domain ProcessCapture without importing domain package
export type CaptureDomain = 'coding' | 'study_learning' | 'writing_creative' | 'planning_productivity' | 'physical_task' | 'general';

export interface CaptureProfile {
  domain: CaptureDomain;
  allowedModalities: string[];
  quickSignals: string[];
  primaryInput: string;
  optionalInputs: string[];
  maxUploads: number;
  instructions: string;
}

export interface ProcessCapture {
  captureType: 'process_signal' | 'process_thought';
  signal?: string;
  content?: string;
  timestamp: string;
}
