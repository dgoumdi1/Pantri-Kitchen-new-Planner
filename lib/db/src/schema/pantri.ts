import {
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const pantriAccountDataTable = pgTable("pantri_account_data", {
  userId: text("user_id").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const pantriAssistantMessagesTable = pgTable(
  "pantri_assistant_messages",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const pantriImportsTable = pgTable(
  "pantri_imports",
  {
    userId: text("user_id").notNull(),
    requestId: text("request_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.requestId] })],
);

