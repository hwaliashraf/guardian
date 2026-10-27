import type { AgeTier } from './ageTier';

export interface ContentCategory {
  id: string;
  label: string;
  defaultBlockedFor: AgeTier[];
}

// Canonical category id list — the contract every ticket touching
// `ContentFilterPolicy.categories` (T02) must use. 32 entries, covers every example spec §3.2
// names verbatim: adult ('adult'), porn ('pornography'), violence ('violence'), gambling
// ('gambling'), advertisements ('advertisements'), social ('social_media'), games ('gaming').
// `defaultBlockedFor` drives `getAgeBasedPreset` below — young/preteen get the most
// conservative defaults, teen defaults loosen for categories that are ordinary browsing
// (gaming, video, news, shopping, social/messaging/forums) but stay blocked for anything
// safety-critical (explicit content, violence/gore, drugs, self-harm, security risks) at every
// tier.
export const CONTENT_CATEGORIES: ContentCategory[] = [
  { id: 'adult', label: 'Adult Content', defaultBlockedFor: ['young', 'preteen', 'teen'] },
  { id: 'pornography', label: 'Pornography', defaultBlockedFor: ['young', 'preteen', 'teen'] },
  { id: 'nudity', label: 'Nudity', defaultBlockedFor: ['young', 'preteen', 'teen'] },
  { id: 'violence', label: 'Violence', defaultBlockedFor: ['young', 'preteen'] },
  { id: 'gambling', label: 'Gambling', defaultBlockedFor: ['young', 'preteen', 'teen'] },
  { id: 'weapons', label: 'Weapons', defaultBlockedFor: ['young', 'preteen'] },
  { id: 'drugs', label: 'Drugs', defaultBlockedFor: ['young', 'preteen', 'teen'] },
  { id: 'alcohol_tobacco', label: 'Alcohol & Tobacco', defaultBlockedFor: ['young', 'preteen', 'teen'] },
  { id: 'hate_speech', label: 'Hate Speech', defaultBlockedFor: ['young', 'preteen', 'teen'] },
  { id: 'self_harm', label: 'Self-Harm', defaultBlockedFor: ['young', 'preteen', 'teen'] },
  { id: 'dating', label: 'Dating', defaultBlockedFor: ['young', 'preteen'] },
  { id: 'gore', label: 'Gore', defaultBlockedFor: ['young', 'preteen', 'teen'] },
  { id: 'advertisements', label: 'Advertisements', defaultBlockedFor: ['young', 'preteen'] },
  { id: 'adult_ad_networks', label: 'Adult Ad Networks', defaultBlockedFor: ['young', 'preteen', 'teen'] },
  { id: 'trackers', label: 'Trackers', defaultBlockedFor: ['young', 'preteen', 'teen'] },
  { id: 'malware_phishing', label: 'Malware & Phishing', defaultBlockedFor: ['young', 'preteen', 'teen'] },
  { id: 'proxy_vpn_bypass', label: 'Proxy / VPN Bypass', defaultBlockedFor: ['young', 'preteen', 'teen'] },
  { id: 'social_media', label: 'Social Media', defaultBlockedFor: ['young'] },
  { id: 'gaming', label: 'Gaming', defaultBlockedFor: [] },
  { id: 'video_streaming', label: 'Video Streaming', defaultBlockedFor: [] },
  { id: 'messaging', label: 'Messaging', defaultBlockedFor: ['young'] },
  { id: 'file_sharing', label: 'File Sharing', defaultBlockedFor: ['young', 'preteen'] },
  { id: 'torrents', label: 'Torrents', defaultBlockedFor: ['young', 'preteen', 'teen'] },
  { id: 'news', label: 'News', defaultBlockedFor: [] },
  { id: 'shopping', label: 'Shopping', defaultBlockedFor: ['young'] },
  { id: 'forums_chat', label: 'Forums & Chat', defaultBlockedFor: ['young'] },
  { id: 'pornography_ai_generated', label: 'AI-Generated Pornography', defaultBlockedFor: ['young', 'preteen', 'teen'] },
  { id: 'cryptocurrency', label: 'Cryptocurrency', defaultBlockedFor: ['young', 'preteen'] },
  { id: 'job_search', label: 'Job Search', defaultBlockedFor: [] },
  { id: 'education', label: 'Education', defaultBlockedFor: [] },
  { id: 'search_engines', label: 'Search Engines', defaultBlockedFor: [] },
  { id: 'productivity', label: 'Productivity', defaultBlockedFor: [] },
];

export function getAgeBasedPreset(ageTier: AgeTier): Record<string, 'block' | 'allow'> {
  const preset: Record<string, 'block' | 'allow'> = {};
  for (const category of CONTENT_CATEGORIES) {
    preset[category.id] = category.defaultBlockedFor.includes(ageTier) ? 'block' : 'allow';
  }
  return preset;
}
