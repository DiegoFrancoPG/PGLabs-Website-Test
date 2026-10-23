import { describe, it, expect } from "vitest";
import { classSchema, classCreateSchema, classPatchSchema } from "@/features/content/content";
import { classDetailSchema } from "@/features/learning/learning";

/*
 * D-24: a lesson's learning goal, written by the author and shown beside the
 * player. M39 adds the column; these are the application's side of it.
 */

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  module_id: "22222222-2222-4222-8222-222222222222",
  version_id: "33333333-3333-4333-8333-333333333333",
  title: "Video", kind: "video", required: true, position: 0,
  body_md: "", source_text: "", duration_ms: 600000, primary_asset_id: null, youtube_video_id: null,
};

describe("reading classes from a database without M39", () => {
  it("treats a missing learning_goal as empty instead of failing the read", () => {
    expect(classSchema.parse(row).learning_goal).toBe("");
    expect(classDetailSchema.shape.class.parse(row).learning_goal).toBe("");
  });

  it("keeps the goal when the database has one", () => {
    const goal = "Explain what a language model is.";
    expect(classSchema.parse({ ...row, learning_goal: goal }).learning_goal).toBe(goal);
    expect(classDetailSchema.shape.class.parse({ ...row, learning_goal: goal }).learning_goal).toBe(goal);
  });
});

describe("writing a learning goal", () => {
  it("is optional when a class is created", () => {
    expect(classCreateSchema.safeParse({ title: "Lesson" }).success).toBe(true);
  });

  it("is trimmed and accepted on create and patch", () => {
    expect(classCreateSchema.parse({ title: "Lesson", learning_goal: "  Name two risks.  " }).learning_goal).toBe(
      "Name two risks."
    );
    expect(classPatchSchema.parse({ learning_goal: "Name two risks." }).learning_goal).toBe("Name two risks.");
  });

  it("may be cleared", () => {
    expect(classPatchSchema.parse({ learning_goal: "" }).learning_goal).toBe("");
  });

  it("is refused past 500 characters, as the database would", () => {
    expect(classPatchSchema.safeParse({ learning_goal: "a".repeat(500) }).success).toBe(true);
    expect(classPatchSchema.safeParse({ learning_goal: "a".repeat(501) }).success).toBe(false);
  });
});
