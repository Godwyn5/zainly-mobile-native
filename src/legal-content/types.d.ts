declare module '@/legal-content/privacy.json' {
  interface LegalSection {
    title: string;
    content: string;
  }

  interface LegalContent {
    title: string;
    lastUpdated: string;
    contactEmail: string;
    sections: LegalSection[];
  }

  const content: LegalContent;
  export default content;
}

declare module '@/legal-content/terms.json' {
  interface LegalSection {
    title: string;
    content: string;
  }

  interface LegalContent {
    title: string;
    lastUpdated: string;
    contactEmail: string;
    sections: LegalSection[];
  }

  const content: LegalContent;
  export default content;
}
