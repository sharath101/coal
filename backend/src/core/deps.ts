import type { AiProvider } from '../modules/ai/provider';
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
  /** The model provider, or null where the AI isn't set up: the chat endpoints then say so. */
  ai: AiProvider | null;
  /** The time, in one place so tests can move it forward (due dates and reminders depend on today). */
  now: () => Date;
  /**
   * How COAL reaches the public sources research searches (docs/workstation-and-ai.md#researching-what-already-exists).
   * Tests put a stand-in here, so they never reach the internet.
   */
  fetchOutside: typeof fetch;
}
