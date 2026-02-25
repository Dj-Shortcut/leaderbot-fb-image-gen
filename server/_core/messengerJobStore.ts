export type MessengerImageJob = {
  userId: string;
  style: string;
  imageJobId: string;
  timestamp: number;
};

const jobs: MessengerImageJob[] = [];

export function recordImageJob(job: MessengerImageJob): void {
  jobs.push(job);
}

export function listImageJobs(): MessengerImageJob[] {
  return [...jobs];
}

export function resetImageJobs(): void {
  jobs.length = 0;
}
