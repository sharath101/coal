import type { PdfRenderer } from '../modules/documents/pdf';
import type { VirusScanner } from '../modules/files/scanner';
import type { FileStorage } from '../modules/files/storage';
import type { AppConfig } from './config';
import type { Db } from './db/client';

/** What every endpoint handler and job can use. */
export interface AppDeps {
  config: AppConfig;
  db: Db;
  storage: FileStorage;
  pdf: PdfRenderer;
  /** Null where no virus scanner is set up (docs/documents-and-signing.md#files-pictures-and-sources). */
  scanner: VirusScanner | null;
}
