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

export function getCaptureProfile(domain: string | null | undefined): CaptureProfile {
  const normalizedDomain = (domain || 'general').toLowerCase() as CaptureDomain;

  switch (normalizedDomain) {
    case 'coding':
      return {
        domain: 'coding',
        allowedModalities: ['text', 'image', 'file'],
        quickSignals: ['STUCK', 'GUESSING', 'THINKING', 'OVERTHINKING', 'CHANGING APPROACH', 'NEED A HINT', 'GOT IT'],
        primaryInput: 'text',
        optionalInputs: ['screenshot', 'file'],
        maxUploads: 5,
        instructions: "Don't explain your solution. Just dump whatever's in your head.",
      };
    case 'study_learning':
      return {
        domain: 'study_learning',
        allowedModalities: ['text', 'image', 'file'],
        quickSignals: ['CONFUSED', 'I KNOW THIS', 'GUESSING', 'STUCK', 'GOT IT', 'CONNECTING IT', 'NEED A HINT'],
        primaryInput: 'text',
        optionalInputs: ['image', 'file'],
        maxUploads: 5,
        instructions: "Don't polish it. Just dump your thoughts as you learn.",
      };
    case 'writing_creative':
      return {
        domain: 'writing_creative',
        allowedModalities: ['text', 'image', 'file'],
        quickSignals: ['STUCK', 'NEW IDEA', 'SCRAPPING THIS', 'REVISING', 'DONE'],
        primaryInput: 'text',
        optionalInputs: ['image', 'file'],
        maxUploads: 3,
        instructions: "Dump your thoughts or paste a quick draft snippet.",
      };
    case 'physical_task':
      return {
        domain: 'physical_task',
        allowedModalities: ['signal', 'text', 'image'],
        quickSignals: ['STARTING', 'STRUGGLING', 'PUSHING THROUGH', 'DONE'],
        primaryInput: 'signal',
        optionalInputs: ['text', 'image'],
        maxUploads: 1,
        instructions: "Tap a quick signal while you move, or leave a short thought.",
      };
    default:
      return {
        domain: 'general',
        allowedModalities: ['text', 'image', 'file'],
        quickSignals: ['STUCK', 'THINKING', 'CHANGING APPROACH', 'GOT IT', 'NEED A HINT'],
        primaryInput: 'text',
        optionalInputs: ['image', 'file'],
        maxUploads: 3,
        instructions: "Don't explain shit. Just dump whatever's in your head.",
      };
  }
}
