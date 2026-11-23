import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';

export const subscription = pgTable('subscription', {
  id: text('id').primaryKey(),
  plan: text('plan').notNull(),
  referenceId: text('reference_id').notNull(),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  status: text('status').default('incomplete'),
  periodStart: timestamp('period_start'),
  periodEnd: timestamp('period_end'),
  trialStart: timestamp('trial_start'),
  trialEnd: timestamp('trial_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false),
  cancelAt: timestamp('cancel_at'),
  canceledAt: timestamp('canceled_at'),
  endedAt: timestamp('ended_at'),
  seats: integer('seats'),
  billingInterval: text('billing_interval'),
  stripeScheduleId: text('stripe_schedule_id'),
});

export const creemSubscription = pgTable('creem_subscription', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull(),
  referenceId: text('reference_id').notNull(),
  creemCustomerId: text('creem_customer_id'),
  creemSubscriptionId: text('creem_subscription_id'),
  creemOrderId: text('creem_order_id'),
  status: text('status').default('active'),
  periodStart: timestamp('period_start'),
  periodEnd: timestamp('period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false),
});

export const creem_subscription = creemSubscription;
