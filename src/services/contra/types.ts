/**
 * Contra.com Job Search & Apply — Type Definitions
 */

export interface ContraJob {
  id: string;
  title: string;
  description: string;
  skills: string[];
  budgetMin?: number;
  budgetMax?: number;
  budgetType: 'hourly' | 'fixed' | 'unknown';
  clientName: string;
  clientRating?: number;
  postedAt: string;
  url: string;
  isRemote: boolean;
  category?: string;
  fitScore?: number; // 0-100, set after GLM-5 evaluation
}

export interface SearchFilters {
  keywords?: string;
  skills?: string[];
  budgetMin?: number;
  budgetMax?: number;
  jobType?: 'hourly' | 'fixed';
  limit?: number;
  category?: 'software' | 'ai-ml' | 'data-science' | 'all';
}

export interface ApplicationResult {
  success: boolean;
  jobId: string;
  applicationId?: string;
  message: string;
  appliedAt?: string;
}

export interface Application {
  id: string;
  jobId: string;
  jobTitle: string;
  status: 'pending' | 'viewed' | 'shortlisted' | 'rejected' | 'hired';
  appliedAt: string;
  coverLetterSnippet: string;
}

export interface UserProfile {
  name: string;
  skills: string[];
  bio: string;
  hourlyRate?: number;
  portfolioUrl?: string;
}

export interface AutoApplyOptions {
  keywords?: string;
  maxApplications?: number;
  minFitScore?: number;
  dryRun?: boolean; // If true, search and evaluate but don't actually apply
}

export interface AutoApplySummary {
  jobsFound: number;
  jobsEvaluated: number;
  jobsApplied: number;
  jobsSkipped: number;
  applications: ApplicationResult[];
  errors: string[];
}

export interface JobFitEvaluation {
  jobId: string;
  fitScore: number; // 0-100
  reasoning: string;
  shouldApply: boolean;
}
