import { z } from 'zod';
const text=z.string().trim();
export const preferencesSchema=z.object({
  skills:z.array(text.min(1).max(80)).min(1).max(100),
  min_budget:z.number().min(0).max(1000000),min_hourly_rate:z.number().min(0).max(10000),
  currency:z.string().regex(/^[A-Z]{3}$/),allow_unknown_budget:z.boolean(),
  work_types:z.array(z.enum(['fixed','hourly','unknown'])).min(1).max(3),
  experience_levels:z.array(z.enum(['entry','intermediate','expert','unknown'])).min(1).max(4),
  min_score:z.number().int().min(0).max(100),max_job_age_days:z.number().int().min(1).max(90),
  max_daily_applications:z.number().int().min(0).max(50),max_daily_spend:z.number().min(0).max(1000),
  hourly_rate:z.number().positive().max(10000),default_delivery_days:z.number().int().min(1).max(365),
  verified_profile:text.max(8000),portfolio_items:z.array(z.object({title:text.min(1).max(160),url:z.url().max(2048).refine(s=>s.startsWith('https://'),'Portfolio URLs must use HTTPS'),description:text.max(2000)})).max(30),
  auto_generate_proposals:z.boolean(),ai_enabled:z.boolean(),timezone:z.literal('Asia/Kolkata'),
  notify_email:z.boolean(),notify_telegram:z.boolean(),
  notification_email:z.union([z.email(),z.literal('')]),telegram_chat_id:z.string().regex(/^-?\d{5,20}$|^$/),
  notification_excerpt:z.boolean(),retention_days:z.number().int().min(7).max(365)
}).partial().strict();
export const proposalEditSchema=z.object({body:text.min(20).max(20000),suggested_price:z.number().min(0).max(1000000),delivery_days:z.number().int().min(1).max(365)}).strict();
export const templateSchema=z.object({name:text.min(1).max(120),body:text.min(20).max(10000)}).strict();
export const gigSchema=z.object({title:text.min(5).max(160),description:text.min(20).max(10000),keywords:z.array(text.max(80)).max(30).default([]),packages:text.max(5000).default('')}).strict();
export const confirmationSchema=z.object({confirmation:text.min(10).max(3000),submitted_at:z.iso.datetime({offset:true}).optional(),spend_amount:z.number().min(0).max(1000).default(0)}).strict();
export function validate(schema,data) { return schema.parse(data); }
