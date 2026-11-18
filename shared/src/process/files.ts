/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import { parseRoute, type RouteDefinition } from './definition';

/**
 * Reads the route files in this folder (Node only: the backend loads them into the database
 * on deploy, and tests use them). Clients get routes from the API.
 */
const FOLDER = new URL('./', import.meta.url);

export interface RouteFile {
  file: string;
  route: RouteDefinition;
}

export function loadRouteFiles(options: { roles?: string[] } = {}): RouteFile[] {
  return readdirSync(FOLDER)
    .filter((file) => /^[a-z][a-z0-9-]*\.v\d+\.yaml$/.test(file))
    .sort()
    .map((file) => {
      const route = parseRoute(parse(readFileSync(new URL(file, FOLDER), 'utf8')), options);
      const expected = `${route.process}.v${route.version}.yaml`;
      if (file !== expected)
        throw new Error(`${file} defines ${route.process} v${route.version}; name it ${expected}`);
      return { file, route };
    });
}

export function loadRoute(process: string, version: number, options: { roles?: string[] } = {}) {
  const found = loadRouteFiles(options).find(
    (f) => f.route.process === process && f.route.version === version,
  );
  if (!found) throw new Error(`There is no route file for ${process} v${version}`);
  return found.route;
}
