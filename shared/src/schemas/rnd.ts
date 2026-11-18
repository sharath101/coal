import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { Id } from './common';

export const ProductLine = z.object({
  id: Id,
  code: z.string(),
  name: z.string(),
});
export type ProductLine = z.infer<typeof ProductLine>;

export const ProductLinesResponse = z.object({ items: z.array(ProductLine) });

export const listProductLines = defineEndpoint({
  id: 'rnd.listProductLines',
  method: 'GET',
  path: '/product-lines',
  summary: "R&D's product lines, for the sign-up form",
  auth: 'public',
  permission: 'rnd.productLines.read',
  aiTier: 'read',
  response: ProductLinesResponse,
});
