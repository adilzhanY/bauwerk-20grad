import { describe, expect, it } from "vitest";
import { colorFor } from "@/sync/colors";
import { mentionParts } from "./mentions";

const members = [{ userId: "u1", username: "anna_pc1" }];

describe("mentionParts", () => {
  it("marks a member's complete username in that person's colour, in any case", () => {
    expect(mentionParts("hi @Anna_PC1, look", members)).toEqual([
      { text: "hi " },
      { text: "@Anna_PC1", color: colorFor("u1") },
      { text: ", look" },
    ]);
  });

  it("leaves half typed names, unknown names and email addresses plain", () => {
    for (const text of ["@anna_p", "@anna_pc12", "@nobody", "mail anna@anna_pc1"]) {
      expect(mentionParts(text, members)).toEqual([{ text }]);
    }
  });
});
