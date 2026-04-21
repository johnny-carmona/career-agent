export interface JobCriteria {
    workType: { remote: boolean; hybrid: boolean; onsite: boolean };
    /** Keys are job type keywords used in the search query (e.g. "full-stack", "react"). Add any freely. */
    jobType: Record<string, boolean>;
    /**
     * Case-insensitive substring keywords matched against a job's location field.
     * A job passes if its location contains ANY of these keywords.
     * Empty array means no location filter — all locations accepted.
     * Examples: ["Worldwide", "USA", "US", "anywhere"]
     */
    locationKeywords: string[];
}

export interface QueuedJob {
    jobId: string;
    board: string;
    title: string;
    company: string;
    location: string;
    url: string;
    snippet?: string;
    salary?: string;
    status: "new" | "processing" | "skipped";
}

export interface AppliedJob {
    jobId: string;
    board: string;
    title: string;
    company: string;
    companyUrl: string;
    jobDescription: string;
    url: string;
    questionsAndAnswers: { question: string; answer: string }[];
    appliedAt: string;
}

export interface ScrapedJob {
    jobId: string;
    board: string;
    title: string;
    company: string;
    location: string;
    url: string;
    snippet?: string;
}
