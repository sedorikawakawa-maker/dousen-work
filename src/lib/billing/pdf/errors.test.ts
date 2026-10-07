import { describe, expect, it } from "vitest";
import { toSafeGenerationErrorMessage } from "./errors";

describe("toSafeGenerationErrorMessage", () => {
  it("Errorインスタンスからmessageだけを取り出す（スタックトレースを含めない）", () => {
    const err = new Error("something went wrong");
    const message = toSafeGenerationErrorMessage(err);
    expect(message).toBe("something went wrong");
    expect(message).not.toContain("at ");
  });

  it("Error以外の値も文字列化する", () => {
    expect(toSafeGenerationErrorMessage("plain string error")).toBe("plain string error");
    expect(toSafeGenerationErrorMessage(123)).toBe("123");
  });

  it("長すぎるメッセージは500文字に切り詰める", () => {
    const longMessage = "a".repeat(1000);
    const result = toSafeGenerationErrorMessage(new Error(longMessage));
    expect(result.length).toBe(500);
  });
});
