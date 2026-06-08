export interface SummaryEntry {
  title: string;
  route: string;
  srcPath: string;
  children?: SummaryEntry[];
}

export declare const summary: SummaryEntry[];
