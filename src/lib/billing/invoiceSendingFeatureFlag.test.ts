import { describe, expect, it } from "vitest";
import { SENDING_ENABLED } from "./invoiceSendingFeatureFlag";

describe("SENDING_ENABLED", () => {
  it("税額・税込請求額の計算ルールが未確定のため、現時点ではfalse（送付操作はUIから不可）", () => {
    expect(SENDING_ENABLED).toBe(false);
  });
});
