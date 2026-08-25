import { describe, it, expect } from "vitest";
import { resolveInitialProject } from "@/lib/settingsProject";

// VSK-28: Settings must open on the project the caller asked for (e.g. a
// ticket's "Manage labels" link), not always the newest project.
describe("resolveInitialProject", () => {
  const projects = [{ id: "gan" }, { id: "vsh" }, { id: "vsk" }];

  it("returns the requested project when it exists (FR2)", () => {
    expect(resolveInitialProject(projects, "vsk")).toBe("vsk");
  });

  it("falls back to the first project when the requested id is unknown", () => {
    expect(resolveInitialProject(projects, "nope")).toBe("gan");
  });

  it("falls back to the first project when no id is requested", () => {
    expect(resolveInitialProject(projects, undefined)).toBe("gan");
    expect(resolveInitialProject(projects, null)).toBe("gan");
    expect(resolveInitialProject(projects, "")).toBe("gan");
  });

  it("returns an empty string when there are no projects", () => {
    expect(resolveInitialProject([], "vsk")).toBe("");
    expect(resolveInitialProject([], undefined)).toBe("");
  });
});
