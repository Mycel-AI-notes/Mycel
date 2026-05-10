export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
}

export interface NoteMeta {
  title?: string;
  tags?: string[];
  created?: string;
  modified?: string;
}

export interface Heading {
  level: number;
  text: string;
}

export interface WikiLink {
  target: string;
  alias?: string;
  is_embed: boolean;
}

export interface ParsedNote {
  meta: NoteMeta;
  body: string;
  headings: Heading[];
  wikilinks: WikiLink[];
  tags: string[];
}

export interface Note {
  path: string;
  content: string;
  parsed: ParsedNote;
}

export interface Tab {
  path: string;
  title: string;
  isDirty: boolean;
  /// Preview tabs are transient: opening another preview tab replaces them
  /// instead of appending. Saving the file promotes a preview tab to a
  /// regular pinned tab. Double-clicking the tab also pins it.
  isPreview?: boolean;
}
