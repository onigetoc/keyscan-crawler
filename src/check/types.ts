export type ContentType = 'html' | 'markdown' | 'pdf' | 'text' | 'unknown';

export interface CheckResult {
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  contentType: string | null;
  detectedType: ContentType;
  accessible: boolean;
  redirected: boolean;
  markdownAlternative: MarkdownProbe | null;
}

export interface MarkdownProbe {
  url: string;
  exists: boolean;
  isSoft404: boolean;
  status: number;
}
