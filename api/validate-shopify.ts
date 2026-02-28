import { VercelRequest, VercelResponse } from '@vercel/node';
import { validateShopifyConnection } from './shopify-utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return validateShopifyConnection(res);
}
