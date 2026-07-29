export interface LegalContent {
  title: string;
  lastUpdated: string;
  contactEmail: string;
  sections: LegalSection[];
}

export interface LegalSection {
  title: string;
  content: string;
}
