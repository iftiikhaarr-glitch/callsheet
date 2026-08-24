import { createInsertSchema } from "drizzle-zod";
import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const callsheetProjectsTable = pgTable("callsheet_projects", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  filename: text("filename"),
  sourceObjectKey: text("source_object_key"),
  status: text("status").notNull().default("draft"),
  sceneCount: integer("scene_count").notNull().default(0),
  progress: integer("progress").notNull().default(0),
  errorMessage: text("error_message"),
  schedule: jsonb("schedule"),
  scheduleError: text("schedule_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const callsheetScenesTable = pgTable("callsheet_scenes", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => callsheetProjectsTable.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  intExt: text("int_ext").notNull(),
  location: text("location").notNull(),
  timeOfDay: text("time_of_day").notNull(),
  pageEighths: integer("page_eighths").notNull(),
  synopsis: text("synopsis").notNull(),
  rawText: text("raw_text").notNull(),
  elements: jsonb("elements").$type<Record<string, string[]>>().notNull(),
});

export const insertCallsheetProjectSchema = createInsertSchema(callsheetProjectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertCallsheetSceneSchema = createInsertSchema(callsheetScenesTable).omit({ id: true });

export type CallsheetProject = typeof callsheetProjectsTable.$inferSelect;
export type CallsheetScene = typeof callsheetScenesTable.$inferSelect;
export type InsertCallsheetProject = z.infer<typeof insertCallsheetProjectSchema>;
export type InsertCallsheetScene = z.infer<typeof insertCallsheetSceneSchema>;