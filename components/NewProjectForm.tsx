"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDialogs } from "./Dialogs";
import { LIMITS } from "@/lib/limits";

export default function NewProjectForm() {
  const router = useRouter();
  const dialogs = useDialogs();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !key.trim()) return;
    setBusy(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), key: key.trim().toUpperCase() }),
    });
    setBusy(false);
    if (res.ok) {
      setName("");
      setKey("");
      router.refresh();
    } else {
      const { error } = await res.json().catch(() => ({ error: "Failed" }));
      await dialogs.alert({
        title: "Couldn't create project",
        message: error ?? "Failed to create project",
      });
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <input
        placeholder="Project name"
        value={name}
        maxLength={LIMITS.projectName}
        onChange={(e) => setName(e.target.value)}
        style={{ minWidth: 220 }}
      />
      <input
        placeholder="KEY (e.g. VSK)"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        style={{ width: 140 }}
        maxLength={LIMITS.projectKey}
      />
      <button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create project"}
      </button>
    </form>
  );
}
