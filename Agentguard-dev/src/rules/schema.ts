import { z } from 'zod';

export const EASRuleSchema = z.object({
  id: z.string().min(1, 'Rule ID is required'),
  name: z.string().min(1, 'Rule name is required'),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  platforms: z.array(z.enum(['windows', 'linux', 'darwin', 'all'])),
  category: z.string().min(1),
  pattern: z.string().min(1, 'Regex pattern is required'),
  flags: z.string().optional().default('i'),
  root_cause: z.string().min(5, 'Root cause description is required'),
  destructive_impact: z.string().min(5, 'Destructive impact description is required'),
  safe_alternative: z.string().min(5, 'Safe alternative prescription is required'),
  enabled: z.boolean().optional().default(true)
});

export const EASDatabaseSchema = z.object({
  $schema: z.string().optional(),
  version: z.string(),
  updated_at: z.string().optional(),
  rules: z.array(EASRuleSchema)
});
