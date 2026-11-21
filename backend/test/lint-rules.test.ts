import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import coal from '../../eslint-plugin-coal.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const at = (file: string) => path.join(root, file);
const tester = new RuleTester({ languageOptions: { ecmaVersion: 2023, sourceType: 'module' } });

tester.run('coal/part-boundaries', coal.rules['part-boundaries'], {
  valid: [
    { filename: at('web/src/app/page.tsx'), code: "import { getMe } from '@coal/shared';" },
    { filename: at('backend/src/app.ts'), code: "import { ENDPOINTS } from '@coal/shared';" },
    { filename: at('shared/src/index.ts'), code: "import { z } from 'zod';" },
  ],
  invalid: [
    {
      filename: at('web/src/lib/api.ts'),
      code: "import { buildApp } from '@coal/backend';",
      errors: [{ messageId: 'forbidden' }],
    },
    {
      filename: at('web/src/lib/api.ts'),
      code: "import { users } from '../../../backend/src/modules/users/tables';",
      errors: [{ messageId: 'forbidden' }],
    },
    {
      filename: at('shared/src/api/client.ts'),
      code: "export * from '../../../web/src/lib/x';",
      errors: [{ messageId: 'forbidden' }],
    },
  ],
});

tester.run('coal/module-tables', coal.rules['module-tables'], {
  valid: [
    {
      filename: at('backend/src/modules/users/service.ts'),
      code: "import { users } from './tables';",
    },
    {
      filename: at('backend/src/modules/auth/service.ts'),
      code: "import { findUser } from '../users/service';",
    },
    // Table files may point at other tables for foreign keys.
    {
      filename: at('backend/src/modules/users/tables.ts'),
      code: "import { roles } from '../org/tables';",
    },
    // The AI exam reads the records as evidence, the way the tests do.
    {
      filename: at('backend/eval/observe.ts'),
      code: "import { auditEvents } from '../src/modules/audit/tables';",
    },
  ],
  invalid: [
    {
      filename: at('backend/src/modules/auth/service.ts'),
      code: "import { users } from '../users/tables';",
      errors: [{ messageId: 'foreign' }],
    },
    {
      filename: at('backend/src/jobs/index.ts'),
      code: "import { auditEvents } from '../modules/audit/tables';",
      errors: [{ messageId: 'foreign' }],
    },
  ],
});
