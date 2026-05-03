import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const AgentRole = {
  orchestrator: "orchestrator",
  planner: "planner",
  researcher: "researcher",
  coder: "coder",
  reviewer: "reviewer",
  tester: "tester",
} as const;

export const AgentStatus = {
  idle: "idle",
  running: "running",
  waiting: "waiting",
  completed: "completed",
  failed: "failed",
} as const;

export const agentsTable = pgTable("agents", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("idle"),
  aiModel: text("ai_model").notNull().default("auto"),
  currentTask: text("current_task"),
  shortTermMemory: jsonb("short_term_memory").default({}).notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const agentTasksTable = pgTable("agent_tasks", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  agentId: integer("agent_id"),
  taskIndex: integer("task_index").notNull().default(0),
  title: text("title").notNull(),
  description: text("description").notNull(),
  assignedTo: text("assigned_to").notNull().default("coder"),
  status: text("status").notNull().default("pending"),
  priority: integer("priority").notNull().default(0),
  result: text("result"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  metadata: jsonb("metadata").default({}).notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const agentMessagesTable = pgTable("agent_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  fromAgent: text("from_agent").notNull(),
  toAgent: text("to_agent").notNull(),
  messageType: text("message_type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  processed: integer("processed").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAgentSchema = createInsertSchema(agentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;

export const insertAgentTaskSchema = createInsertSchema(agentTasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAgentTask = z.infer<typeof insertAgentTaskSchema>;
export type AgentTask = typeof agentTasksTable.$inferSelect;

export const insertAgentMessageSchema = createInsertSchema(agentMessagesTable).omit({ id: true, createdAt: true });
export type InsertAgentMessage = z.infer<typeof insertAgentMessageSchema>;
export type AgentMessage = typeof agentMessagesTable.$inferSelect;
