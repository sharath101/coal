import { getRequestConfig } from 'next-intl/server';

// English first; every piece of website text lives in messages/ (P22).
export default getRequestConfig(async () => {
  const locale = 'en';
  const messages = (await import(`../../messages/${locale}.json`)) as {
    default: Record<string, unknown>;
  };
  return { locale, timeZone: 'Asia/Kolkata', messages: messages.default };
});
